"""
ByteTrack wrapper.

Thin wrapper around supervision.ByteTracker that:
  - Keeps per-track centroid history deques for trail + speed computation
  - Exposes get_trail() and get_speed() for frame_processor
  - Handles empty-detection ticks so lost tracks age out correctly
"""
from __future__ import annotations

from collections import defaultdict, deque

import numpy as np
import supervision as sv


class FishTracker:
    def __init__(self, settings):
        self._settings = settings
        self._tracker: sv.ByteTrack | None = None
        self._centroids: dict[int, deque[tuple[float, float]]] = defaultdict(
            lambda: deque(maxlen=settings.centroid_history_len)
        )
        self._frame_count = 0
        self._last_track_count = 0
        # frame_count of last observation per track_id — for centroid GC
        self._last_seen: dict[int, int] = {}

    # ------------------------------------------------------------------

    def reset(self) -> None:
        self._tracker = sv.ByteTrack(
            track_activation_threshold=0.35,
            lost_track_buffer=self._settings.tracker_max_age,
            minimum_matching_threshold=0.80,
            minimum_consecutive_frames=self._settings.tracker_min_hits,
        )
        self._centroids.clear()
        self._last_seen.clear()
        self._frame_count = 0
        self._last_track_count = 0

    def update(self, detections: sv.Detections) -> sv.Detections:
        """Feed detections; returns sv.Detections with .tracker_id populated."""
        assert self._tracker is not None, "Call reset() before update()"

        self._frame_count += 1

        if detections.is_empty():
            # Tick the tracker with an empty frame so lost tracks age out.
            empty = sv.Detections(
                xyxy=np.empty((0, 4), dtype=np.float32),
                confidence=np.empty((0,), dtype=np.float32),
                class_id=np.empty((0,), dtype=int),
            )
            tracked = self._tracker.update_with_detections(empty)
        else:
            tracked = self._tracker.update_with_detections(detections)

        if tracked.tracker_id is not None:
            self._last_track_count = len(tracked.tracker_id)
            for i, tid in enumerate(tracked.tracker_id):
                x1, y1, x2, y2 = tracked.xyxy[i]
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                tid_int = int(tid)
                self._centroids[tid_int].append((float(cx), float(cy)))
                self._last_seen[tid_int] = self._frame_count

            # Prune centroid history for track IDs gone for > 2× the lost-track buffer.
            # ByteTrack uses monotonically increasing IDs — old ones are never reused,
            # so without this the dict grows forever over multi-day runs.
            gc_threshold = self._settings.tracker_max_age * 2
            stale = [
                tid for tid, last in self._last_seen.items()
                if self._frame_count - last > gc_threshold
            ]
            for tid in stale:
                self._centroids.pop(tid, None)
                del self._last_seen[tid]
        else:
            self._last_track_count = 0

        return tracked

    # ------------------------------------------------------------------

    def get_trail(self, track_id: int, max_points: int = 15) -> list[list[float]]:
        """Last N centroid positions as [[x,y], ...] for WS payload."""
        hist = list(self._centroids.get(track_id, deque()))
        return [[x, y] for x, y in hist[-max_points:]]

    def get_speed(self, track_id: int) -> float:
        """Mean pixel-distance per frame over last 5 centroids."""
        hist = list(self._centroids.get(track_id, deque()))
        if len(hist) < 2:
            return 0.0
        pts = hist[-5:]
        dists = [
            ((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2) ** 0.5
            for i in range(1, len(pts))
        ]
        return float(np.mean(dists))

    @property
    def active_track_count(self) -> int:
        return self._last_track_count
