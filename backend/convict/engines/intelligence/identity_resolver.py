"""
Identity resolver — per-frame cost matrix assignment.

For each active track, compute a cost vector against every known fish, then
use scipy.optimize.linear_sum_assignment for an optimal 1-to-1 assignment.
Confidence is EMA-smoothed so a single bad frame doesn't flip an identity.

Cost components (weights in settings, must sum to 1.0):
  size   (0.20) — bbox extent vs fish size_class / estimated_length_cm
  zone   (0.30) — current zone vs fish.preferred_zones
  color  (0.35) — HSV histogram L1 distance (neutral if no histogram yet)
  path   (0.15) — inverse of previous EMA confidence (continuity prior)
"""
from __future__ import annotations

import json
from collections import defaultdict

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

_SIZE_CM: dict[str, float] = {"small": 6.0, "medium": 13.0, "large": 22.0}


class IdentityResolver:
    def __init__(self, settings, known_fish: list, zones: list, tank_width_cm: float = 60.0):
        self._s              = settings
        self._fish           = known_fish   # list[KnownFish ORM]
        self._zones          = zones        # list[Zone ORM]
        self._tank_width_cm  = max(tank_width_cm, 1.0)

        # track_id → {fish_uuid → EMA confidence}
        self._hyp: dict[int, dict[str, float]] = defaultdict(dict)
        # track_id → best fish_uuid (above identity_min_confidence)
        self._best: dict[int, str] = {}

    # ------------------------------------------------------------------

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def reload_fish(self, fish_list: list) -> None:
        """
        Queued hot-reload — applied at the top of the next resolve() call.
        Safe to call from async context while resolve() runs in a thread:
        CPython GIL protects the reference assignment; only one resolve()
        is in-flight at a time via asyncio.to_thread.
        """
        self._pending_fish = fish_list

    def hint_track_identity(self, track_id: int, fish_uuid: str) -> None:
        """
        Pre-seed the EMA hypothesis at 0.40 for a reacquired track.
        Used by AutoRegistrar when dedup detects a track reacquisition
        for an already-registered fish (instead of creating a duplicate).
        """
        self._hyp[track_id][fish_uuid] = max(
            self._hyp[track_id].get(fish_uuid, 0.0), 0.40
        )

    def resolve(self, entities: list[dict], frame: np.ndarray) -> list[dict]:
        """
        Synchronous — safe to call from asyncio.to_thread.
        Assigns identity to each entity in-place; returns the same list.
        """
        # Apply pending hot-reload (set by reload_fish() from async context)
        if (pending := getattr(self, "_pending_fish", None)) is not None:
            self._fish = pending
            self._pending_fish = None

        if not self._fish or not entities:
            return entities

        n_t = len(entities)
        n_f = len(self._fish)
        costs = np.ones((n_t, n_f), dtype=np.float32)

        for i, e in enumerate(entities):
            for j, fish in enumerate(self._fish):
                costs[i, j] = self._cost(e, fish, frame)

        row_ind, col_ind = linear_sum_assignment(costs)

        alpha = self._s.identity_ema_alpha
        for r, c in zip(row_ind, col_ind):
            e    = entities[r]
            fish = self._fish[c]
            tid  = e["track_id"]
            fid  = fish.uuid

            raw_conf = max(0.0, 1.0 - float(costs[r, c]))
            prev     = self._hyp[tid].get(fid, raw_conf)
            smoothed = (1.0 - alpha) * prev + alpha * raw_conf
            self._hyp[tid][fid] = smoothed

            if smoothed >= self._s.identity_min_confidence:
                self._best[tid] = fid
                e["identity"] = {
                    "fish_id":       fid,
                    "fish_name":     fish.name,
                    "confidence":    round(smoothed, 3),
                    "is_confirmed":  False,
                }

        # Prune stale tracks
        active = {e["track_id"] for e in entities}
        for tid in list(self._hyp):
            if tid not in active:
                del self._hyp[tid]
                self._best.pop(tid, None)

        return entities

    def top_hypotheses(self) -> list[dict]:
        """Best hypothesis per track for identity_update WS messages."""
        out: list[dict] = []
        fish_map = {f.uuid: f for f in self._fish}
        for tid, confs in self._hyp.items():
            if not confs:
                continue
            best_fid  = max(confs, key=confs.__getitem__)
            best_conf = confs[best_fid]
            fish      = fish_map.get(best_fid)
            out.append({
                "track_id":   tid,
                "fish_id":    best_fid,
                "fish_name":  fish.name if fish else None,
                "confidence": round(best_conf, 3),
                "is_confirmed": False,
            })
        return out

    def extract_histogram(self, frame: np.ndarray, bbox: list) -> bytes | None:
        """Extract HSV histogram from bbox region. Returns bytes for DB storage."""
        x1, y1, x2, y2 = [int(v) for v in bbox]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return None
        return self._hist(frame[y1:y2, x1:x2]).tobytes()

    # ------------------------------------------------------------------
    # Cost components
    # ------------------------------------------------------------------

    def _cost(self, e: dict, fish, frame: np.ndarray) -> float:
        s = self._s
        c_size  = self._c_size(e, fish, frame.shape[1])
        c_zone  = self._c_zone(e, fish)
        c_color = self._c_color(e, fish, frame)
        c_path  = 1.0 - self._hyp[e["track_id"]].get(fish.uuid, 0.0)
        return (
            s.cost_weight_size  * c_size  +
            s.cost_weight_zone  * c_zone  +
            s.cost_weight_color * c_color +
            s.cost_weight_path  * c_path
        )

    def _c_size(self, e: dict, fish, frame_w: int) -> float:
        x1, y1, x2, y2 = e["bbox"]
        bbox_px = max(x2 - x1, y2 - y1)
        scale   = self._tank_width_cm / max(frame_w, 1)
        est_cm  = bbox_px * scale
        target  = (fish.estimated_length_cm or 0) or _SIZE_CM.get(fish.size_class, 13.0)
        diff    = abs(est_cm - target) / max(target, 1.0)
        return float(min(diff, 1.0))

    def _c_zone(self, e: dict, fish) -> float:
        preferred: list[str] = json.loads(fish.preferred_zones) if fish.preferred_zones else []
        if not preferred:
            return 0.3  # neutral — no prior set yet
        return 0.0 if any(z in e["zone_ids"] for z in preferred) else 0.7

    def _c_color(self, e: dict, fish, frame: np.ndarray) -> float:
        if fish.color_histogram is None:
            return 0.3  # neutral — no histogram yet

        x1, y1, x2, y2 = [int(v) for v in e["bbox"]]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return 0.3

        live   = self._hist(frame[y1:y2, x1:x2])
        stored = np.frombuffer(fish.color_histogram, dtype=np.float32)
        if live.shape != stored.shape:
            return 0.3

        # L1 of normalised histograms ∈ [0, 2] → normalise to [0, 1]
        return float(min(np.sum(np.abs(live - stored)) / 2.0, 1.0))

    # ------------------------------------------------------------------

    @staticmethod
    def _hist(roi: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        h   = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
        h   = h.flatten().astype(np.float32)
        s   = h.sum()
        return h / s if s > 0 else h
