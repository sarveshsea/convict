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

    def update_zones(self, zones: list) -> None:
        self._zones = zones

    def set_identity_resolver(self, resolver: Any) -> None:
        self._resolver = resolver

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
        for e in entities:
            x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
            ident = e["identity"]
            conf  = ident.get("confidence", 0.0)

            # Colour by identity confidence
            if ident["fish_id"]:
                if conf >= 0.7:
                    colour = (52, 211, 153)   # emerald
                elif conf >= 0.4:
                    colour = (251, 191, 36)   # amber
                else:
                    colour = (244,  63,  94)  # rose
            else:
                colour = (100, 200, 255)      # unidentified — blue

            # Corner brackets instead of full rectangle
            clen = max(8, min((x2 - x1) // 5, (y2 - y1) // 5, 18))
            for (px, py, dx, dy) in [
                (x1, y1,  1,  1), (x2, y1, -1,  1),
                (x1, y2,  1, -1), (x2, y2, -1, -1),
            ]:
                cv2.line(frame, (px, py), (px + dx * clen, py), colour, 2, cv2.LINE_AA)
                cv2.line(frame, (px, py), (px, py + dy * clen), colour, 2, cv2.LINE_AA)

            label = (
                f"{ident['fish_name']} {conf*100:.0f}%"
                if ident["fish_name"]
                else f"T{e['track_id']}"
            )
            cv2.putText(frame, label, (x1, max(y1 - 6, 14)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, colour, 1, cv2.LINE_AA)

            # Trail — gradient from dim (old) to bright (recent)
            trail = e["trail"]
            n     = len(trail)
            for j in range(1, n):
                alpha = j / n
                tc = (int(colour[0] * alpha), int(colour[1] * alpha), int(colour[2] * alpha))
                p1 = (int(trail[j - 1][0]), int(trail[j - 1][1]))
                p2 = (int(trail[j][0]),     int(trail[j][1]))
                cv2.line(frame, p1, p2, tc, 2, cv2.LINE_AA)

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
        """Save a cropped JPEG for each confidently-identified fish (max once per 60s)."""
        import time
        snap_dir = settings.db_path.parent / "snapshots"
        snap_dir.mkdir(parents=True, exist_ok=True)
        now = time.time()
        h, w = frame.shape[:2]
        for e in entities:
            ident = e["identity"]
            if not ident["fish_id"] or ident["confidence"] < 0.70:
                continue
            snap_path = snap_dir / f"{ident['fish_id']}.jpg"
            if snap_path.exists() and (now - snap_path.stat().st_mtime) < 60:
                continue
            x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
            pad_x = max(8, int((x2 - x1) * 0.12))
            pad_y = max(8, int((y2 - y1) * 0.12))
            crop = frame[max(0, y1 - pad_y):min(h, y2 + pad_y),
                         max(0, x1 - pad_x):min(w, x2 + pad_x)]
            if crop.size == 0:
                continue
            cv2.imwrite(str(snap_path), crop, [cv2.IMWRITE_JPEG_QUALITY, 88])

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
