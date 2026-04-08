"""
Flow and clarity analyzer — runs every frame.

1. Optical flow (Lucas-Kanade, background only)
   Tracks sparse feature points in regions with no fish. Net drift vector
   gives water current direction; near-zero magnitude over time = pump/filter
   stall. Spatial dead-zone detection divides the frame into a 3×3 grid and
   flags cells with persistently low flow relative to the rest of the tank.

2. Clarity entropy
   Computes Shannon entropy of the grayscale histogram each frame.
   High entropy = lots of tonal variation = clear water.
   A sustained downward entropy trend = turbidity/algae increase.

Events emitted (same shape as AnomalyDetector events):
  flow_stalled        — mean flow magnitude < threshold for 30s
  dead_zone_detected  — one or more quadrants near-zero while others flow
  visibility_degrading — entropy downward trend over last 60s

Overlay dict (GIL-safe, read by FrameProcessor._render_jpeg):
  flow_vectors  : list[(px, py, dx, dy)] — sampled displacement arrows
  flow_status   : "ok" | "stalled"
  flow_mag      : float — mean pixel displacement this frame
  clarity       : float 0–1
  clarity_status: "ok" | "degrading"
  dead_zones    : list[int] — grid-cell indices (row*3+col) with low flow
"""
from __future__ import annotations

import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import NamedTuple

import cv2
import numpy as np


_LK_PARAMS = dict(
    winSize=(15, 15),
    maxLevel=3,
    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
)
_FEATURE_PARAMS = dict(
    maxCorners=60,
    qualityLevel=0.01,
    minDistance=10,
    blockSize=3,
)

# Minimum mean displacement (px/frame) to count as "flowing"
_FLOW_THRESHOLD     = 0.35
# How many consecutive check-windows must be stalled before firing
_STALL_WINDOWS      = 3
# Entropy slope threshold (bits / frame) — fire if trend is more negative
_ENTROPY_SLOPE_THR  = -0.003
# Grid dimensions for dead-zone detection
_GRID_ROWS, _GRID_COLS = 3, 3


class FlowAnalyzer:
    def __init__(self, settings):
        self._s           = settings
        self._frame_count = 0

        # Optical flow state
        self._prev_gray: np.ndarray | None = None
        self._prev_pts:  np.ndarray | None = None  # (N, 1, 2) float32

        # Rolling magnitude window (~40s at 5fps = 200 samples)
        self._mag_ring: deque[float] = deque(maxlen=200)

        # Grid-cell magnitude rings for dead-zone detection
        # key: (row, col) → deque of mean magnitudes
        self._cell_mags: dict[tuple, deque] = defaultdict(lambda: deque(maxlen=120))

        # Clarity entropy ring (~60s)
        self._entropy_ring: deque[float] = deque(maxlen=300)

        # Consecutive stall windows counter
        self._stall_window_count: int = 0

        # Cooldowns in frames
        self._stall_cooldown:   int = 0
        self._clarity_cooldown: int = 0
        self._dead_zone_cooldown: int = 0

        # Overlay exposed to FrameProcessor (GIL-safe dict replace)
        self._overlay: dict = {
            "flow_vectors":   [],
            "flow_status":    "ok",
            "flow_mag":       0.0,
            "clarity":        1.0,
            "clarity_status": "ok",
            "dead_zones":     [],
        }

        # Pending events — drained by orchestrator via pop_events()
        self._events: list[dict] = []

    # ------------------------------------------------------------------

    def update(self, frame: np.ndarray, entities: list[dict]) -> None:
        """Call every frame (safe in asyncio.to_thread)."""
        self._frame_count += 1

        # Tick cooldowns
        if self._stall_cooldown    > 0: self._stall_cooldown    -= 1
        if self._clarity_cooldown  > 0: self._clarity_cooldown  -= 1
        if self._dead_zone_cooldown > 0: self._dead_zone_cooldown -= 1

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        clarity = self._update_clarity(gray)
        vectors, mag, dead_zones, stalled = self._update_flow(gray, entities, frame.shape)

        # Compose overlay (single dict replace = GIL-atomic)
        self._overlay = {
            "flow_vectors":   vectors,
            "flow_status":    "stalled" if stalled else "ok",
            "flow_mag":       round(mag, 2),
            "clarity":        round(clarity, 2),
            "clarity_status": "degrading" if clarity < 0.52 else "ok",
            "dead_zones":     dead_zones,
        }

    def pop_events(self) -> list[dict]:
        """Drain pending anomaly events — called by orchestrator each frame."""
        result = self._events[:]
        self._events.clear()
        return result

    def get_overlay(self) -> dict:
        return self._overlay

    # ------------------------------------------------------------------
    # Clarity
    # ------------------------------------------------------------------

    def _update_clarity(self, gray: np.ndarray) -> float:
        hist  = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
        total = float(hist.sum())
        if total <= 0:
            return self._overlay.get("clarity", 1.0)

        p       = hist / total
        nonzero = p[p > 0]
        entropy = float(-np.sum(nonzero * np.log2(nonzero)))  # 0–8 bits

        self._entropy_ring.append(entropy)
        clarity = min(entropy / 7.0, 1.0)

        # Fire if sustained downward trend (need ≥150 samples = ~30s)
        if len(self._entropy_ring) >= 150 and self._clarity_cooldown == 0:
            arr  = np.array(self._entropy_ring, dtype=np.float32)
            xs   = np.arange(len(arr), dtype=np.float32)
            slope = float(np.polyfit(xs, arr, 1)[0])
            if slope < _ENTROPY_SLOPE_THR:
                self._events.append(self._make("visibility_degrading", "medium", []))
                self._clarity_cooldown = 600  # ~2min at 5fps

        return clarity

    # ------------------------------------------------------------------
    # Optical flow
    # ------------------------------------------------------------------

    def _update_flow(
        self,
        gray:     np.ndarray,
        entities: list[dict],
        shape:    tuple,
    ) -> tuple[list, float, list, bool]:
        """
        Returns (vectors, mean_mag, dead_zone_cells, is_stalled).
        """
        fh, fw = shape[:2]

        if self._prev_gray is None:
            self._prev_gray = gray
            return [], 0.0, [], False

        # ── Build background mask ─────────────────────────────────────
        mask = np.full(gray.shape, 255, dtype=np.uint8)
        for e in entities:
            x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
            mask[max(0, y1 - 8):min(fh, y2 + 8),
                 max(0, x1 - 8):min(fw, x2 + 8)] = 0

        # ── Re-detect features every 30 frames or when too few survive ──
        need_refresh = (
            self._prev_pts is None
            or self._frame_count % 30 == 0
            or (self._prev_pts is not None and len(self._prev_pts) < 8)
        )
        if need_refresh:
            pts = cv2.goodFeaturesToTrack(self._prev_gray, mask=mask, **_FEATURE_PARAMS)
            if pts is None or len(pts) < 5:
                self._prev_gray = gray
                self._prev_pts  = None
                self._mag_ring.append(0.0)
                return [], 0.0, [], self._is_stalled()
            self._prev_pts = pts

        # ── Lucas-Kanade ──────────────────────────────────────────────
        curr_pts, status, _ = cv2.calcOpticalFlowPyrLK(
            self._prev_gray, gray, self._prev_pts, None, **_LK_PARAMS
        )

        good = (status.flatten() == 1)
        prev_good = self._prev_pts[good]
        curr_good = curr_pts[good]

        self._prev_gray = gray
        self._prev_pts  = curr_good.reshape(-1, 1, 2) if len(curr_good) >= 5 else None

        if len(prev_good) < 5:
            self._mag_ring.append(0.0)
            return [], 0.0, [], self._is_stalled()

        disp = (curr_good - prev_good).reshape(-1, 2)
        mags = np.linalg.norm(disp, axis=1)
        mean_mag = float(np.mean(mags))
        self._mag_ring.append(mean_mag)

        # ── Dead-zone grid ────────────────────────────────────────────
        # Assign each tracked point to its grid cell and accumulate mag
        cell_w = fw / _GRID_COLS
        cell_h = fh / _GRID_ROWS
        for i, pt in enumerate(prev_good):
            col = int(min(pt[0, 0] / cell_w, _GRID_COLS - 1))
            row = int(min(pt[0, 1] / cell_h, _GRID_ROWS - 1))
            self._cell_mags[(row, col)].append(float(mags[i]))

        dead_zones = self._detect_dead_zones()

        # ── Stall detection ───────────────────────────────────────────
        if len(self._mag_ring) >= 90:
            recent_mean = float(np.mean(list(self._mag_ring)[-90:]))
            if recent_mean < _FLOW_THRESHOLD:
                self._stall_window_count += 1
            else:
                self._stall_window_count = max(0, self._stall_window_count - 1)

            if self._stall_window_count >= _STALL_WINDOWS and self._stall_cooldown == 0:
                self._events.append(self._make("flow_stalled", "medium", []))
                self._stall_cooldown     = 600
                self._stall_window_count = 0

        stalled = self._is_stalled()

        # ── Sample vectors for overlay ────────────────────────────────
        n   = min(18, len(prev_good))
        idx = np.random.choice(len(prev_good), n, replace=False)
        vectors = [
            (
                int(prev_good[i, 0, 0]), int(prev_good[i, 0, 1]),
                int(disp[i, 0]),          int(disp[i, 1]),
            )
            for i in idx
        ]

        return vectors, mean_mag, dead_zones, stalled

    def _is_stalled(self) -> bool:
        if len(self._mag_ring) < 90:
            return False
        return float(np.mean(list(self._mag_ring)[-90:])) < _FLOW_THRESHOLD

    def _detect_dead_zones(self) -> list[int]:
        """
        Returns grid-cell indices (row*3+col) that have near-zero mean flow
        while the overall tank mean is meaningfully positive.
        Only fires when we have at least 30 samples per cell.
        """
        if self._dead_zone_cooldown > 0:
            return []

        cell_means: dict[tuple, float] = {}
        for (r, c), ring in self._cell_mags.items():
            if len(ring) >= 30:
                cell_means[(r, c)] = float(np.mean(ring))

        if len(cell_means) < 4:
            return []

        global_mean = float(np.mean(list(cell_means.values())))
        if global_mean < _FLOW_THRESHOLD:
            return []  # whole tank low — stall, not dead zone

        dead = [
            r * _GRID_COLS + c
            for (r, c), m in cell_means.items()
            if m < global_mean * 0.25   # cell is <25% of tank mean
        ]
        if dead:
            self._events.append(self._make(
                "dead_zone_detected", "low",
                [],
            ))
            self._dead_zone_cooldown = 1200  # 4min cool-down

        return dead

    # ------------------------------------------------------------------

    @staticmethod
    def _make(event_type: str, severity: str, involved: list) -> dict:
        return {
            "uuid":          str(uuid.uuid4()),
            "event_type":    event_type,
            "severity":      severity,
            "started_at":    datetime.now(timezone.utc).isoformat(),
            "involved_fish": involved,
            "zone_id":       None,
        }
