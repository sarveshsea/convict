"""
Per-frame pipeline:
  detect (thread) → track → identity resolve (thread) → zone assignment
  → annotate+encode (thread) → push MJPEG → broadcast WS observation_frame

Returns the final entity list so the orchestrator can feed it to
baseline_builder and anomaly_detector.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np

from convict.config import settings
from convict.engines.observation.mjpeg_streamer import streamer as _default_streamer
from convict.engines.observation.nxt_sensor import nxt_manager
from convict.engines.experience.ws_broadcaster import broadcaster


class FrameProcessor:
    def __init__(
        self,
        camera: Any,
        detector: Any,
        tracker: Any,
        zones: list,
        identity_resolver: Any = None,
        mjpeg_streamer=None,
        camera_index: int = 0,
    ):
        self._camera    = camera
        self._detector  = detector
        self._tracker   = tracker
        self._zones     = zones
        self._resolver  = identity_resolver
        self._streamer  = mjpeg_streamer or _default_streamer
        self._camera_index = camera_index

        self._seq: int = 0
        self._latency_ring: deque[float] = deque(maxlen=30)
        self._is_night: bool = False

        # Overlay data written by orchestrator, read in _render_jpeg (GIL-safe)
        self._overlay: dict = {}

    def update_zones(self, zones: list) -> None:
        self._zones = zones

    def set_identity_resolver(self, resolver: Any) -> None:
        self._resolver = resolver

    def set_overlay(self, data: dict) -> None:
        """Thread-safe (CPython GIL) — called by orchestrator between frames."""
        self._overlay = data

    # ------------------------------------------------------------------

    async def process(self, frame: np.ndarray) -> list[dict]:
        """
        Run one frame through the full pipeline.
        Returns the final entity list (identity-resolved if resolver is set).
        """
        t0 = time.monotonic()

        # NXT sensor overrides frame-brightness night detection when connected
        enhanced, is_night = await asyncio.to_thread(
            self._enhance, frame, nxt_manager.is_night
        )
        if is_night != self._is_night:
            self._is_night = is_night
            if hasattr(self._detector, "set_var_threshold"):
                self._detector.set_var_threshold(
                    settings.night_bg_var_threshold if is_night else settings.bg_var_threshold
                )
            if hasattr(self._camera, "set_night_mode"):
                self._camera.set_night_mode(is_night)

        # Detection runs in thread — CPU-bound
        detections = await asyncio.to_thread(self._detector.detect, enhanced)

        # Tracking — fast Kalman filter, stays in event loop
        tracked = self._tracker.update(detections)

        # Build entity list
        fh, fw = frame.shape[:2]
        entities = self._build_entities(tracked, fw, fh)

        # Identity resolution — CPU-bound, runs in thread
        if self._resolver is not None and entities:
            entities = await asyncio.to_thread(
                self._resolver.resolve, entities, frame
            )

        # Annotate + encode the enhanced frame (better visual output)
        jpeg_bytes = await asyncio.to_thread(
            self._render_jpeg, enhanced.copy(), entities
        )

        await self._streamer.push(jpeg_bytes)

        # Save per-fish snapshots for identified entities (debounced — 60s min interval)
        if any(e["identity"]["fish_id"] for e in entities):
            await asyncio.to_thread(self._save_snapshots, enhanced, entities)

        self._seq += 1
        self._latency_ring.append(time.monotonic() - t0)

        try:
            now = datetime.now(timezone.utc).isoformat()
            await broadcaster.broadcast({
                "type":      "observation_frame",
                "timestamp": now,
                "seq":       self._seq,
                "payload": {
                    "entities":        entities,
                    "frame_width":     fw,
                    "frame_height":    fh,
                    "fps":             self.fps,
                    "night_mode":      self._is_night,
                    "schedule_context": None,
                    "camera_index":    self._camera_index,
                },
            })
        except Exception:
            pass

        return entities

    # ------------------------------------------------------------------

    def _build_entities(self, tracked, fw: int, fh: int) -> list[dict]:
        if tracked.tracker_id is None:
            return []
        entities: list[dict] = []
        for i, tid in enumerate(tracked.tracker_id):
            x1, y1, x2, y2 = [float(v) for v in tracked.xyxy[i]]
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            conf = float(tracked.confidence[i]) if tracked.confidence is not None else 0.9

            trail = self._tracker.get_trail(int(tid))
            speed = self._tracker.get_speed(int(tid))

            fx, fy = cx / fw, cy / fh
            zone_ids = [
                z.uuid
                for z in self._zones
                if z.x_min <= fx <= z.x_max and z.y_min <= fy <= z.y_max
            ]

            entities.append({
                "track_id":           int(tid),
                "bbox":               [x1, y1, x2, y2],
                "centroid":           [cx, cy],
                "confidence":         conf,
                "identity":           {"fish_id": None, "fish_name": None,
                                       "confidence": 0.0, "is_confirmed": False},
                "zone_ids":           zone_ids,
                "speed_px_per_frame": speed,
                "trail":              trail,
            })
        return entities

    # ------------------------------------------------------------------

    @staticmethod
    def _white_balance(frame: np.ndarray) -> np.ndarray:
        """
        Partial gray-world white balance (70% blend) — takes the edge off strong
        color casts without overcorrecting to a flat neutral image.
        """
        b, g, r = cv2.split(frame.astype(np.float32))
        b_avg, g_avg, r_avg = b.mean(), g.mean(), r.mean()
        if min(b_avg, g_avg, r_avg) < 1.0:
            return frame
        gray_avg = (b_avg + g_avg + r_avg) / 3.0
        blend = 0.70   # 0 = no correction, 1 = full gray world
        b = np.clip(b * (1 + blend * (gray_avg / b_avg - 1)), 0, 255)
        g = np.clip(g * (1 + blend * (gray_avg / g_avg - 1)), 0, 255)
        r = np.clip(r * (1 + blend * (gray_avg / r_avg - 1)), 0, 255)
        return cv2.merge([b, g, r]).astype(np.uint8)

    @staticmethod
    def _gamma(frame: np.ndarray, gamma: float = 0.88) -> np.ndarray:
        """Lift dark midtones without blowing highlights."""
        lut = np.array([
            min(255, int(255 * (i / 255.0) ** gamma))
            for i in range(256)
        ], dtype=np.uint8)
        return cv2.LUT(frame, lut)

    @staticmethod
    def _enhance(frame: np.ndarray, night_override: bool | None = None) -> tuple[np.ndarray, bool]:
        """
        Dispatch to day or night enhancement pipeline.

        Priority:
          1. NXT sensor reading (if connected) — most reliable
          2. Tank light schedule (night_start_hour / night_end_hour) — always known
          3. Frame brightness fallback — last resort if schedule not configured
        """
        frame = FrameProcessor._white_balance(frame)
        frame = FrameProcessor._gamma(frame)

        if night_override is not None:
            night = night_override
        else:
            from datetime import datetime
            h = datetime.now().hour
            s, e = settings.night_start_hour, settings.night_end_hour
            if s != e:  # schedule is configured
                night = h >= s or h < e
            else:       # fallback: read frame brightness
                gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                night = float(gray.mean()) < settings.night_brightness_threshold
        if night:
            return FrameProcessor._enhance_night(frame), True
        return FrameProcessor._enhance_day(frame), False

    @staticmethod
    def _enhance_day(frame: np.ndarray) -> np.ndarray:
        """
        Daytime pipeline for glass-fronted tanks:
          1. Bilateral filter — smooths noise while keeping fish edges hard
          2. Highlight suppression — pulls near-white glare blobs toward local avg
          3. CLAHE on LAB L-channel — equalises contrast after glare crush
          4. Unsharp mask — brings fish edges back to sharp
        """
        smooth = cv2.bilateralFilter(frame, 9, 75, 75)

        gray     = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
        _, mask  = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY)
        mask     = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)
        mask_f   = (mask / 255.0).astype(np.float32)

        blurred  = cv2.GaussianBlur(smooth, (21, 21), 0).astype(np.float32)
        f        = smooth.astype(np.float32)
        alpha    = mask_f[:, :, np.newaxis] * 0.80
        crushed  = (f * (1 - alpha) + blurred * alpha).clip(0, 255).astype(np.uint8)

        lab      = cv2.cvtColor(crushed, cv2.COLOR_BGR2LAB)
        l, a, b  = cv2.split(lab)
        clahe    = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l        = clahe.apply(l)
        enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

        blur2    = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.5)
        sharpened = cv2.addWeighted(enhanced, 1.4, blur2, -0.4, 0)

        # Saturation boost — fish pop against driftwood/plant background
        hsv = cv2.cvtColor(sharpened, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.35, 0, 255)
        return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    @staticmethod
    def _enhance_night(frame: np.ndarray) -> np.ndarray:
        """
        Nighttime pipeline — low SNR, no glare, high sensor noise:
          1. Heavy bilateral filter — aggressive denoising without destroying edges
          2. CLAHE with low clip on large tiles — lifts dark detail without noise amplification
          3. Very gentle unsharp mask — minimal sharpening to avoid ringing on noisy edges
        """
        # 1. Heavy denoise (larger d and sigma than daytime)
        smooth = cv2.bilateralFilter(frame, 11, 100, 100)

        # 2. Low-clip CLAHE on larger tiles to avoid blotchy contrast patches
        lab      = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB)
        l, a, b  = cv2.split(lab)
        clahe    = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(16, 16))
        l        = clahe.apply(l)
        enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

        # 3. Gentle unsharp — enough to recover soft edges, not enough to ring noise
        blur2    = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=2.0)
        return cv2.addWeighted(enhanced, 1.2, blur2, -0.2, 0)

    # ------------------------------------------------------------------

    def _render_jpeg(self, frame: np.ndarray, entities: list[dict]) -> bytes:
        overlay = self._overlay  # single dict read = GIL-atomic
        H, W    = frame.shape[:2]

        prespawn_fish    = overlay.get("prespawn_fish",    set())
        feeding_imminent = overlay.get("feeding_imminent", None)  # {"minutes": N}
        flow_vectors     = overlay.get("flow_vectors",     [])
        flow_status      = overlay.get("flow_status",      "ok")
        clarity          = overlay.get("clarity",          1.0)
        clarity_status   = overlay.get("clarity_status",   "ok")

        # ── 1. Flow arrows (background) ───────────────────────────────
        # Scale displacements so even slow flows are visible at ≥5px
        if flow_vectors:
            arrow_col = (52, 211, 153) if flow_status == "ok" else (251, 146, 60)
            for (px, py, dx, dy) in flow_vectors:
                # Amplify: scale so 0.5px/frame shows as 5px arrow
                scale = max(1, int(5 / max(abs(dx), abs(dy), 0.1)))
                scale = min(scale, 8)
                ex = int(px + dx * scale)
                ey = int(py + dy * scale)
                if 0 <= px < W and 0 <= py < H and 0 <= ex < W and 0 <= ey < H:
                    cv2.arrowedLine(frame, (px, py), (ex, ey),
                                    arrow_col, 1, cv2.LINE_AA, tipLength=0.4)

        # ── 2. Feeding imminent banner (top of frame) ─────────────────
        if feeding_imminent is not None:
            mins = feeding_imminent.get("minutes", 0)
            label = f"feeding in {int(mins)}m" if mins > 0 else "feeding now"
            # Semi-transparent amber strip
            banner = frame.copy()
            cv2.rectangle(banner, (0, 0), (W, 22), (0, 0, 0), -1)
            cv2.addWeighted(banner, 0.50, frame, 0.50, 0, frame)
            cv2.putText(frame, label, (8, 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.44,
                        (251, 191, 36), 1, cv2.LINE_AA)

        # ── 3. Fish brackets + labels ─────────────────────────────────
        for e in entities:
            x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
            ident = e["identity"]
            conf  = ident.get("confidence", 0.0)
            fid   = ident["fish_id"]

            # Colour by identity confidence; orange override for pre-spawn
            if fid and fid in prespawn_fish:
                colour = (30, 144, 255)       # deep orange-ish in BGR = (30,144,255) → actually let's use (60,130,240) which looks orange
                colour = (20, 120, 245)       # BGR orange
            elif fid:
                if conf >= 0.7:
                    colour = (52, 211, 153)   # emerald
                elif conf >= 0.4:
                    colour = (251, 191, 36)   # amber
                else:
                    colour = (244,  63,  94)  # rose
            else:
                colour = (100, 200, 255)      # unidentified — blue

            clen = max(8, min((x2 - x1) // 5, (y2 - y1) // 5, 18))
            for (px, py, dx, dy) in [
                (x1, y1,  1,  1), (x2, y1, -1,  1),
                (x1, y2,  1, -1), (x2, y2, -1, -1),
            ]:
                cv2.line(frame, (px, py), (px + dx * clen, py), colour, 2, cv2.LINE_AA)
                cv2.line(frame, (px, py), (px, py + dy * clen), colour, 2, cv2.LINE_AA)

            # Pre-spawn dot indicator
            if fid and fid in prespawn_fish:
                cv2.circle(frame, (x2 - 4, y1 + 4), 3, (20, 120, 245), -1, cv2.LINE_AA)

            label = (
                f"{ident['fish_name']} {conf*100:.0f}%"
                if ident["fish_name"]
                else f"T{e['track_id']}"
            )
            cv2.putText(frame, label, (x1, max(y1 - 6, 14)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, colour, 1, cv2.LINE_AA)

        # ── 4. HUD chip (bottom-left) ─────────────────────────────────
        hud_y      = H - 8
        hud_h      = 34
        hud_w      = 170
        hud_panel  = frame.copy()
        cv2.rectangle(hud_panel, (4, H - hud_h - 4), (4 + hud_w, H - 4), (0, 0, 0), -1)
        cv2.addWeighted(hud_panel, 0.55, frame, 0.45, 0, frame)

        flow_col = (52, 211, 153) if flow_status == "ok" else (251, 146, 60)
        flow_txt = f"flow {flow_status}"
        cv2.putText(frame, flow_txt, (8, H - hud_h + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, flow_col, 1, cv2.LINE_AA)

        clar_pct = int(clarity * 100)
        clar_col = (52, 211, 153) if clar_pct >= 65 else (251, 191, 36) if clar_pct >= 45 else (244, 63, 94)
        clar_txt = f"clarity {clar_pct}%"
        if clarity_status == "degrading":
            clar_txt += " !"
        cv2.putText(frame, clar_txt, (8, H - hud_h + 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, clar_col, 1, cv2.LINE_AA)

        ret, buf = cv2.imencode(
            ".jpg", frame,
            [cv2.IMWRITE_JPEG_QUALITY, settings.mjpeg_quality],
        )
        if not ret:
            raise RuntimeError("JPEG encode failed")
        return buf.tobytes()

    # ------------------------------------------------------------------

    @staticmethod
    def _save_snapshots(frame: np.ndarray, entities: list[dict]) -> None:
        """
        Save cropped JPEGs for each confidently-identified fish.

        - Display snapshot: snapshots/{uuid}.jpg          — debounced 30s, shown in UI
        - Training crops:   snapshots/training/{uuid}/{ms}.jpg + YOLO .txt — up to 20 per fish
        """
        import time
        snap_dir  = settings.db_path.parent / "snapshots"
        train_dir = snap_dir / "training"
        snap_dir.mkdir(parents=True, exist_ok=True)
        now = time.time()
        h, w = frame.shape[:2]

        for e in entities:
            ident   = e["identity"]
            fish_id = ident.get("fish_id")
            if not fish_id or ident.get("confidence", 0) < 0.50:
                continue

            x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
            pad_x = max(12, int((x2 - x1) * 0.18))
            pad_y = max(12, int((y2 - y1) * 0.18))

            # Actual crop bounds (clamped to frame)
            cy1 = max(0, y1 - pad_y); cy2 = min(h, y2 + pad_y)
            cx1 = max(0, x1 - pad_x); cx2 = min(w, x2 + pad_x)
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue

            # Skip blurry / motion-blurred crops (Laplacian variance threshold)
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            if cv2.Laplacian(gray, cv2.CV_64F).var() < 80:
                continue

            # ── Display snapshot (debounced 30s) ──────────────────────────────
            snap_path = snap_dir / f"{fish_id}.jpg"
            if not snap_path.exists() or (now - snap_path.stat().st_mtime) >= 30:
                cv2.imwrite(str(snap_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 93])

            # ── Training crops (one per 10s, max 20 per fish) ─────────────────
            fish_train_dir = train_dir / str(fish_id)
            fish_train_dir.mkdir(parents=True, exist_ok=True)

            existing = sorted(fish_train_dir.glob("*.jpg"))
            if existing and now - existing[-1].stat().st_mtime < 10:
                continue   # rate-limit

            ts = int(now * 1000)
            cv2.imwrite(str(fish_train_dir / f"{ts}.jpg"), crop,
                        [cv2.IMWRITE_JPEG_QUALITY, 93])

            # YOLO annotation (class 0, fish centred in padded crop)
            crop_w = cx2 - cx1; crop_h = cy2 - cy1
            ann_cx = ((x1 + x2) / 2 - cx1) / crop_w
            ann_cy = ((y1 + y2) / 2 - cy1) / crop_h
            ann_bw = (x2 - x1) / crop_w
            ann_bh = (y2 - y1) / crop_h
            (fish_train_dir / f"{ts}.txt").write_text(
                f"0 {ann_cx:.4f} {ann_cy:.4f} {ann_bw:.4f} {ann_bh:.4f}\n"
            )

            # Circular buffer — keep latest 20
            all_crops = sorted(fish_train_dir.glob("*.jpg"))
            if len(all_crops) > 20:
                for old in all_crops[:-20]:
                    old.unlink(missing_ok=True)
                    old.with_suffix(".txt").unlink(missing_ok=True)

    @property
    def identity_health(self) -> float:
        """Mean EMA confidence across all currently-identified tracks (0–1)."""
        if self._resolver is None:
            return 0.0
        try:
            hyps = self._resolver.top_hypotheses()
            if not hyps:
                return 0.0
            return round(sum(h["confidence"] for h in hyps) / len(hyps), 3)
        except Exception:
            return 0.0

    @property
    def fps(self) -> float:
        if not self._latency_ring:
            return 0.0
        m = sum(self._latency_ring) / len(self._latency_ring)
        return round(1.0 / m, 1) if m > 0 else 0.0

    @property
    def last_latency_ms(self) -> float:
        return (self._latency_ring[-1] * 1000) if self._latency_ring else 0.0
