"""
Pipeline orchestrator — M4: full pipeline with predictions and patterns.

Per-frame loop (6.6fps):
  detect → track → identity resolve → MJPEG → WS observation_frame
  baseline.update() → anomaly.update() → broadcast anomaly events
  baseline flush every 5min

Periodic loop (every prediction_interval_seconds = 5min):
  pattern_modeler.run() + prediction_engine.run() → broadcast predictions
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

import logging

from convict.config import settings
from convict.engines.experience.ws_broadcaster import broadcaster

log = logging.getLogger("convict.orchestrator")


# How long camera must be inactive before the watchdog restarts the pipeline (seconds)
_CAMERA_DEAD_TIMEOUT = 45.0


class PipelineOrchestrator:
    def __init__(self):
        self._running    = False
        self._task: asyncio.Task | None          = None
        self._pred_task: asyncio.Task | None     = None
        self._cam2_task: asyncio.Task | None     = None
        self._vlm_task: asyncio.Task | None      = None
        self._watchdog_task: asyncio.Task | None = None
        self._started_at: datetime | None        = None
        self._camera: Any  = None
        self._processor: Any = None

        self._detection_fps:        float = 0.0
        self._inference_latency_ms: float = 0.0
        self._track_count:          int   = 0
        self._frame_times:          deque = deque(maxlen=10)

    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._running:
            return
        self._running    = True
        self._started_at = datetime.utcnow()
        self._task          = asyncio.create_task(self._run_loop(),       name="pipeline")
        self._pred_task     = asyncio.create_task(self._predict_loop(),   name="predictor")
        self._watchdog_task = asyncio.create_task(self._camera_watchdog(), name="cam-watchdog")
        if settings.vlm_enabled:
            self._vlm_task = asyncio.create_task(self._vlm_analysis_loop(), name="vlm")

    async def stop(self) -> None:
        self._running = False
        for t in [self._task, self._pred_task, self._cam2_task, self._vlm_task, self._watchdog_task]:
            if t:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        self._task = self._pred_task = self._cam2_task = self._vlm_task = self._watchdog_task = None
        if self._camera:
            self._camera.stop()

    def status(self) -> dict:
        from convict.engines.observation.mjpeg_streamer import streamer, streamer2
        # camera_active only if thread is alive AND streamer received a frame recently
        cam_active = bool(
            self._camera and self._camera.is_active and streamer.is_active
        )
        id_health = self._processor.identity_health if self._processor else 0.0
        return {
            "running":                    self._running,
            "started_at":                 self._started_at.isoformat() if self._started_at else None,
            "camera_active":              cam_active,
            "cam2_active":                streamer2.is_active,
            "detection_fps":              round(self._detection_fps, 1),
            "inference_latency_ms":       round(self._inference_latency_ms, 1),
            "track_count":                self._track_count,
            "identity_resolution_health": id_health,
            "queue_lag_frames":           0,
        }

    # ------------------------------------------------------------------
    # Main per-frame loop
    # ------------------------------------------------------------------

    async def _run_loop(self) -> None:
        from convict.engines.observation.camera              import CameraCapture, MockCameraCapture
        from convict.engines.observation.detector            import FishDetector, MockDetector
        from convict.engines.observation.tracker             import FishTracker
        from convict.engines.observation.frame_processor     import FrameProcessor
        from convict.engines.intelligence.identity_resolver  import IdentityResolver
        from convict.engines.intelligence.baseline_builder   import BaselineBuilder
        from convict.engines.intelligence.anomaly_detector   import AnomalyDetector
        from convict.engines.intelligence.pattern_modeler    import PatternModeler
        from convict.engines.intelligence.auto_registrar     import AutoRegistrar
        from convict.engines.experience.prediction_engine    import PredictionEngine
        from convict.database                                import AsyncSessionLocal
        from convict.engines.knowledge.tank_knowledge_engine import list_zones, list_fish, get_tank, list_schedules

        loop    = asyncio.get_running_loop()
        frame_q: asyncio.Queue = asyncio.Queue(maxsize=2)

        # ---- Load known world -----------------------------------------
        zones:     list = []
        fish:      list = []
        schedules: list = []
        tank = None
        try:
            async with AsyncSessionLocal() as db:
                tank      = await get_tank(db)
                zones     = await list_zones(db)
                fish      = await list_fish(db)
                schedules = await list_schedules(db)
        except Exception:
            pass

        # ---- AutoRegistrar (fish auto-discovery) ----------------------
        tank_width_cm = float(getattr(tank, "width_cm", 60.0) or 60.0) if tank else 60.0
        auto_registrar = None
        if tank is not None:
            auto_registrar = AutoRegistrar(settings, tank.id, tank_width_cm=tank_width_cm)
            try:
                async with AsyncSessionLocal() as db:
                    await auto_registrar.initialize(db)
            except Exception:
                pass

        # ---- Build engines --------------------------------------------
        if settings.mock_camera:
            camera   = MockCameraCapture(settings, loop, frame_q)
            detector = MockDetector(camera)
        else:
            camera = CameraCapture(settings, loop, frame_q)
            if settings.detector_type == "rfdetr":
                from convict.engines.observation.detector import RFDETRDetector
                detector = RFDETRDetector(settings)
            elif settings.detector_type == "yolo":
                detector = FishDetector(settings)
            elif settings.detector_type == "yolo_onnx":
                from convict.engines.observation.detector import YOLOOnnxDetector
                detector = YOLOOnnxDetector(settings)
            else:
                from convict.engines.observation.detector import BackgroundSubtractorDetector
                detector = BackgroundSubtractorDetector(settings)
            await asyncio.to_thread(detector.load)

        tracker  = FishTracker(settings)
        tracker.reset()

        from convict.engines.intelligence.community_health import CommunityHealthScorer

        resolver  = IdentityResolver(settings, fish, zones, tank_width_cm=tank_width_cm)
        baseline  = BaselineBuilder(settings)
        baseline.update_known_fish(fish)   # seed known set so first flush can prune correctly
        anomaly   = AnomalyDetector(settings, fish, baseline)
        patterns  = PatternModeler(settings, fish, baseline)
        predictor = PredictionEngine(settings, fish, anomaly, baseline, resolver)
        health    = CommunityHealthScorer(settings, fish, baseline)

        processor = FrameProcessor(camera, detector, tracker, zones,
                                   identity_resolver=resolver)

        self._camera    = camera
        self._processor = processor

        # Share engines with prediction loop and VLM loop via instance attrs
        self._baseline   = baseline
        self._anomaly    = anomaly
        self._patterns   = patterns
        self._predictor  = predictor
        self._health     = health
        self._fish_list  = fish

        camera.start()

        from convict.engines.observation.nxt_sensor import nxt_manager
        nxt_manager.start()

        # Second camera — raw MJPEG stream, no detection
        if settings.camera_index_2 >= 0:
            self._cam2_task = asyncio.create_task(
                self._run_camera2(), name="camera2"
            )

        min_interval       = settings.detection_interval_ms / 1000.0
        status_interval    = 2.0
        fish_refresh_interval = 15.0   # re-sync fish list from DB every 15s
        last_inf_time      = 0.0
        last_status_t      = 0.0
        last_fish_refresh  = 0.0

        log.info(
            "Pipeline started — detector=%s  fish=%d  tank_width_cm=%.1f",
            settings.detector_type, len(fish), tank_width_cm,
        )

        try:
            while self._running:
                try:
                    frame = await asyncio.wait_for(frame_q.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                now      = time.monotonic()
                to_sleep = min_interval - (now - last_inf_time)
                if to_sleep > 0:
                    await asyncio.sleep(to_sleep)
                last_inf_time = time.monotonic()

                entities = await processor.process(frame)

                # Periodic fish-list refresh — picks up manually-added fish
                now_mono = time.monotonic()
                if now_mono - last_fish_refresh >= fish_refresh_interval:
                    try:
                        async with AsyncSessionLocal() as db:
                            fresh_fish = await list_fish(db)
                        if len(fresh_fish) != len(fish):
                            log.info(
                                "Fish list changed: %d → %d, reloading resolver",
                                len(fish), len(fresh_fish),
                            )
                        fish = fresh_fish
                        resolver.reload_fish(fish)
                        anomaly.update_known_fish(fish)
                        patterns.update_known_fish(fish)
                        baseline.update_known_fish(fish)
                        predictor._fish = fish
                        health.update_known_fish(fish)
                        self._fish_list = fish
                    except Exception:
                        log.exception("Fish list refresh failed")
                    last_fish_refresh = now_mono

                # Auto-registration: watches for stable tracks and creates fish profiles
                if auto_registrar is not None:
                    try:
                        async with AsyncSessionLocal() as db:
                            new_fish_created = await auto_registrar.process(
                                entities, frame, resolver, db
                            )
                        if new_fish_created:
                            async with AsyncSessionLocal() as db:
                                fish = await list_fish(db)
                            resolver.reload_fish(fish)
                            anomaly.update_known_fish(fish)
                            patterns.update_known_fish(fish)
                            baseline.update_known_fish(fish)
                            predictor._fish = fish
                            health.update_known_fish(fish)
                            self._fish_list = fish
                            last_fish_refresh = time.monotonic()
                            log.info("Auto-registered new fish — roster now %d", len(fish))
                            await broadcaster.broadcast({
                                "type":      "fish_updated",
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "seq":       0,
                                "payload":   {"reason": "auto_registered"},
                            })
                    except Exception:
                        log.exception("Auto-registrar error")

                try:
                    baseline.update(entities)
                except Exception:
                    log.exception("Baseline update error")

                try:
                    new_events = anomaly.update(entities)
                    if new_events:
                        tank_id = tank.id if tank else None
                        async with AsyncSessionLocal() as db:
                            for ev in new_events:
                                predictor.record_event(ev)
                                ev["schedule_context"] = _nearest_schedule(schedules)
                                if tank_id:
                                    await _persist_behavior_event(ev, tank_id, db)
                                await broadcaster.broadcast({
                                    "type":      "anomaly_flagged",
                                    "timestamp": ev["started_at"],
                                    "seq":       0,
                                    "payload":   ev,
                                })
                            try:
                                await db.commit()
                            except Exception:
                                await db.rollback()
                    else:
                        for ev in new_events:
                            predictor.record_event(ev)
                except Exception:
                    log.exception("Anomaly update/broadcast error")

                try:
                    async with AsyncSessionLocal() as db:
                        await baseline.maybe_flush(db)
                except Exception:
                    pass

                try:
                    self._frame_times.append(time.monotonic())
                    if len(self._frame_times) >= 2:
                        span = self._frame_times[-1] - self._frame_times[0]
                        self._detection_fps = (
                            round((len(self._frame_times) - 1) / span, 1) if span > 0 else 0.0
                        )
                    self._inference_latency_ms = processor.last_latency_ms
                    self._track_count          = tracker.active_track_count
                except Exception:
                    pass

                try:
                    now = time.monotonic()
                    if now - last_status_t >= status_interval:
                        await broadcaster.broadcast({
                            "type":      "pipeline_status",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "seq":       0,
                            "payload":   self.status(),
                        })
                        last_status_t = now
                except Exception:
                    log.exception("Status broadcast error")

        except asyncio.CancelledError:
            pass
        finally:
            camera.stop()
            nxt_manager.stop()

    # ------------------------------------------------------------------
    # Prediction / pattern loop (every 5min)
    # ------------------------------------------------------------------

    async def _predict_loop(self) -> None:
        # Wait for main loop to initialise engines
        await asyncio.sleep(30)

        from convict.database import AsyncSessionLocal

        while self._running:
            try:
                await asyncio.sleep(settings.prediction_interval_seconds)

                if not hasattr(self, "_predictor"):
                    continue

                # ── Drain + persist interaction edges ──────────────────
                if hasattr(self, "_anomaly"):
                    pending = self._anomaly.pop_interactions()
                    if pending:
                        try:
                            await _persist_interaction_edges(pending, db=None)
                        except Exception:
                            log.exception("Interaction edge persistence error")

                async with AsyncSessionLocal() as db:

                    # Patterns
                    new_patterns = await self._patterns.run(db)
                    # Predictions
                    new_preds = await self._predictor.run(db)
                    # Community health
                    health_payload = await self._health.run(db)
                    # Species inference for auto-detected fish
                    if not hasattr(self, "_species_guesser"):
                        from convict.engines.intelligence.species_guesser import SpeciesGuesser
                        self._species_guesser = SpeciesGuesser()
                    species_updates = await self._species_guesser.run(db)

                for u in species_updates:
                    await broadcaster.broadcast({
                        "type":      "fish_updated",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "seq":       0,
                        "payload":   {"reason": "species_guessed", **u},
                    })

                for p in new_preds:
                    await broadcaster.broadcast({
                        "type":      "prediction_created",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "seq":       0,
                        "payload":   p,
                    })

                if health_payload:
                    await broadcaster.broadcast({
                        "type":      "community_health",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "seq":       0,
                        "payload":   health_payload,
                    })

            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Prediction loop error")  # log instead of silently swallowing

    # ------------------------------------------------------------------
    # Camera watchdog — restarts pipeline if camera is dead too long
    # ------------------------------------------------------------------

    async def _camera_watchdog(self) -> None:
        """
        Monitors camera health every 5 seconds.
        If the camera has been inactive for > _CAMERA_DEAD_TIMEOUT seconds,
        restarts the entire pipeline (stop + start) so the camera thread
        is re-created fresh.

        The camera's own _run() thread handles short-term recovery (USB glitches,
        brief stalls) via its internal reopen loop. This watchdog handles the
        case where the camera hardware is genuinely gone for a long time and the
        internal loop isn't recovering.
        """
        from convict.engines.observation.mjpeg_streamer import streamer

        # Give the pipeline time to start before watching
        await asyncio.sleep(20)

        dead_since: float | None = None

        while self._running:
            await asyncio.sleep(5)

            try:
                cam_ok = bool(
                    self._camera
                    and self._camera.is_active
                    and streamer.is_active
                )

                if cam_ok:
                    dead_since = None
                    continue

                now = time.monotonic()
                if dead_since is None:
                    dead_since = now
                    log.warning("Camera watchdog: camera inactive — monitoring")
                    continue

                elapsed = now - dead_since
                if elapsed >= _CAMERA_DEAD_TIMEOUT:
                    log.error(
                        "Camera watchdog: camera dead for %.0fs — restarting pipeline",
                        elapsed,
                    )
                    dead_since = None

                    # Restart pipeline — stop main loop, recreate it
                    if self._task:
                        self._task.cancel()
                        try:
                            await self._task
                        except asyncio.CancelledError:
                            pass
                    if self._camera:
                        self._camera.stop()
                        self._camera = None
                        self._processor = None

                    await asyncio.sleep(2.0)  # brief pause before reopen

                    self._task = asyncio.create_task(
                        self._run_loop(), name="pipeline"
                    )
                    await broadcaster.broadcast({
                        "type":      "pipeline_status",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "seq":       0,
                        "payload":   {**self.status(), "camera_restarting": True},
                    })
                    log.info("Camera watchdog: pipeline restarted")

            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Camera watchdog error")

    # ------------------------------------------------------------------
    # VLM analysis loop (Gemma via Ollama — optional, every N seconds)
    # ------------------------------------------------------------------

    async def _vlm_analysis_loop(self) -> None:
        import logging
        from convict.engines.intelligence.vlm_analyzer import VLMAnalyzer
        from convict.engines.observation.mjpeg_streamer import streamer

        log = logging.getLogger("convict.vlm")
        log.info(
            "VLM analysis loop started (model=%s, interval=%.0fs)",
            settings.vlm_model,
            settings.vlm_analysis_interval_s,
        )

        # Wait for main pipeline to warm up and produce frames
        await asyncio.sleep(60)

        analyzer = VLMAnalyzer(settings)

        while self._running:
            await asyncio.sleep(settings.vlm_analysis_interval_s)

            jpeg = streamer._frame
            if jpeg is None:
                continue

            fish_names = [f.name for f in getattr(self, "_fish_list", [])]

            try:
                obs = await analyzer.analyze(jpeg, fish_names)
            except Exception:
                log.exception("VLM analysis error")
                continue

            if obs is None:
                continue

            # Feed species hints to guesser so it can boost confidence
            if hasattr(self, "_species_guesser") and obs.species_hints:
                self._species_guesser.set_vlm_hints(obs.species_hints)

            # Convert anomalies to event dicts and broadcast
            if hasattr(self, "_anomaly"):
                vlm_events = self._anomaly.ingest_vlm_observation(obs)
                for ev in vlm_events:
                    await broadcaster.broadcast({
                        "type":      "anomaly_flagged",
                        "timestamp": ev["started_at"],
                        "seq":       0,
                        "payload":   ev,
                    })

            # Broadcast the full VLM observation as its own event type
            await broadcaster.broadcast({
                "type":      "vlm_analysis",
                "timestamp": obs.timestamp,
                "seq":       0,
                "payload": {
                    "fish_visible":   obs.fish_visible,
                    "anomalies":      obs.anomalies,
                    "species_hints":  obs.species_hints,
                    "confidence":     obs.confidence,
                    "model":          settings.vlm_model,
                },
            })

            log.debug(
                "VLM: %d fish visible, %d anomalies, hints=%s",
                obs.fish_visible, len(obs.anomalies), obs.species_hints,
            )

    # ------------------------------------------------------------------
    # Second camera — raw MJPEG pump
    # ------------------------------------------------------------------

    async def _run_camera2(self) -> None:
        """Detection pipeline for camera 2 — same MOG2+ByteTrack stack as cam1."""
        import logging
        from convict.engines.observation.camera import CameraCapture
        from convict.engines.observation.detector import BackgroundSubtractorDetector
        from convict.engines.observation.tracker import FishTracker
        from convict.engines.observation.frame_processor import FrameProcessor
        from convict.engines.observation.mjpeg_streamer import streamer2

        log = logging.getLogger("convict.cam2")

        # Brief delay so cam1's AVFoundation session is established first
        await asyncio.sleep(2.0)

        loop = asyncio.get_running_loop()
        q2: asyncio.Queue = asyncio.Queue(maxsize=2)

        class _Cam2Cfg:
            camera_index   = settings.camera_index_2
            capture_width  = settings.capture_width
            capture_height = settings.capture_height

        # Try configured index first, then nearby indices.
        # This helps on Windows where USB camera index ordering can shift.
        candidate_indices = [settings.camera_index_2, 1, 2, 3, 4]
        seen: set[int] = set()
        candidate_indices = [i for i in candidate_indices if i >= 0 and not (i in seen or seen.add(i))]
        current_idx_pos = 0
        _Cam2Cfg.camera_index = candidate_indices[current_idx_pos]

        log.info("Starting camera 2 detection pipeline at index %d", _Cam2Cfg.camera_index)
        cam2 = CameraCapture(_Cam2Cfg(), loop, q2)
        detector2 = BackgroundSubtractorDetector(settings)
        tracker2  = FishTracker(settings)
        tracker2.reset()
        processor2 = FrameProcessor(
            cam2, detector2, tracker2,
            zones=[],
            identity_resolver=None,
            mjpeg_streamer=streamer2,
            camera_index=1,
        )
        cam2.start()

        deadline    = time.monotonic() + 5.0
        first_frame = False
        min_interval    = settings.detection_interval_ms / 1000.0
        last_inf_time   = 0.0

        try:
            while self._running:
                try:
                    frame = await asyncio.wait_for(q2.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    if not first_frame and time.monotonic() > deadline:
                        bad_index = _Cam2Cfg.camera_index
                        if current_idx_pos + 1 < len(candidate_indices):
                            current_idx_pos += 1
                            next_index = candidate_indices[current_idx_pos]
                            log.warning(
                                "Camera 2 index %d produced no frames; switching to index %d",
                                bad_index,
                                next_index,
                            )
                            cam2.stop()
                            _Cam2Cfg.camera_index = next_index
                            cam2 = CameraCapture(_Cam2Cfg(), loop, q2)
                            cam2.start()
                            deadline = time.monotonic() + 5.0
                        else:
                            log.warning(
                                "Camera 2 unavailable across indices %s; check USB bandwidth/power and permissions",
                                candidate_indices,
                            )
                            deadline = float("inf")
                    continue
                first_frame = True

                now      = time.monotonic()
                to_sleep = min_interval - (now - last_inf_time)
                if to_sleep > 0:
                    await asyncio.sleep(to_sleep)
                last_inf_time = time.monotonic()

                await processor2.process(frame)

        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("Camera 2 stream crashed")
        finally:
            cam2.stop()
            log.info("Camera 2 stopped")


def _nearest_schedule(schedules: list) -> dict | None:
    """
    Returns the closest scheduled event to now (within ±30 min) or None.
    Result: {"event_type": "feeding", "minutes_offset": -5}
      negative offset = event was N minutes ago
      positive offset = event is N minutes away
    """
    if not schedules:
        return None
    from datetime import datetime as _dt
    now   = _dt.now()
    today = now.strftime("%a").lower()  # "mon", "tue", …
    best  = None
    best_abs = float("inf")

    for s in schedules:
        days = s.days_of_week if isinstance(s.days_of_week, list) else []
        if days and today not in [d.lower()[:3] for d in days]:
            continue
        try:
            h, m  = map(int, s.time_of_day.split(":"))
        except Exception:
            continue
        offset = (h * 60 + m) - (now.hour * 60 + now.minute)
        if abs(offset) < best_abs and abs(offset) <= 30:
            best_abs = abs(offset)
            best = {"event_type": s.event_type, "minutes_offset": offset}

    return best


async def _persist_behavior_event(ev: dict, tank_id: int, db) -> None:
    """Write one anomaly event dict to the behavior_events table (no commit — caller commits)."""
    import json as _json
    from datetime import datetime as _dt
    from convict.models.behavior_event import BehaviorEvent
    try:
        occurred = _dt.fromisoformat(ev["started_at"].replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        occurred = _dt.utcnow()
    row = BehaviorEvent(
        uuid          = ev["uuid"],
        tank_id       = tank_id,
        event_type    = ev["event_type"],
        severity      = ev.get("severity", "low"),
        occurred_at   = occurred,
        involved_fish = _json.dumps(ev.get("involved_fish", [])),
        zone_id       = ev.get("zone_id"),
        notes         = ev.get("description"),
    )
    db.add(row)


async def _persist_interaction_edges(pending: list[dict], db) -> None:
    """
    Write interaction edge dicts from anomaly_detector to the DB.
    Each dict has: fish_a, fish_b, initiator|None, interaction_type, duration_seconds.
    """
    import uuid as _uuid
    from datetime import datetime as _dt
    from sqlalchemy import select
    from convict.models.known_fish import KnownFish
    from convict.models.interaction_edge import InteractionEdge
    from convict.engines.knowledge.tank_knowledge_engine import get_tank
    from convict.database import AsyncSessionLocal

    if not pending:
        return

    async with AsyncSessionLocal() as _db:
        tank = await get_tank(_db)
        if not tank:
            return

        # Cache fish uuid → DB id for this batch
        all_uuids = set()
        for p in pending:
            all_uuids.add(p["fish_a"])
            all_uuids.add(p["fish_b"])
            if p.get("initiator"):
                all_uuids.add(p["initiator"])

        fish_rows = (await _db.execute(
            select(KnownFish).where(KnownFish.uuid.in_(all_uuids))
        )).scalars().all()
        uuid_to_id = {f.uuid: f.id for f in fish_rows}

        now = _dt.utcnow()
        for p in pending:
            id_a = uuid_to_id.get(p["fish_a"])
            id_b = uuid_to_id.get(p["fish_b"])
            if not id_a or not id_b:
                continue

            # Canonical ordering: smaller DB id first
            if id_a > id_b:
                id_a, id_b = id_b, id_a

            init_id = uuid_to_id.get(p["initiator"]) if p.get("initiator") else None

            edge = InteractionEdge(
                uuid             = str(_uuid.uuid4()),
                tank_id          = tank.id,
                fish_a_id        = id_a,
                fish_b_id        = id_b,
                initiator_id     = init_id,
                interaction_type = p["interaction_type"],
                occurred_at      = now,
                duration_seconds = p.get("duration_seconds", 0.0),
            )
            _db.add(edge)

        try:
            await _db.commit()
        except Exception:
            await _db.rollback()


orchestrator = PipelineOrchestrator()
