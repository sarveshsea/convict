"""
Behavioral baseline builder.

Per-frame: accumulates zone time, speed, activity-by-hour, and pairwise
proximity stats for each identified fish (confidence >= 0.5 only).

Every baseline_flush_interval_frames: writes a snapshot to behavior_baselines.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from datetime import datetime

import numpy as np

# Fish within this pixel distance are considered "in proximity"
_PROXIMITY_PX = 80
# Minimum confident speed samples before we'll persist a baseline.
# Below this, mean/stddev are not statistically meaningful.
_MIN_BASELINE_SAMPLES = 30


class BaselineBuilder:
    def __init__(self, settings):
        self._s = settings
        self._frame_count = 0

        # fish_uuid → zone_uuid → frame count in zone
        self._zone_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        # fish_uuid → speed history (capped deque — no manual slicing needed)
        self._speeds:      dict[str, deque]          = defaultdict(lambda: deque(maxlen=1000))
        # fish_uuid → hour → frame count
        self._by_hour:     dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        # fish_uuid → total confident frames seen
        self._totals:      dict[str, int]             = defaultdict(int)
        # fish_uuid → other_fish_uuid → frames spent within _PROXIMITY_PX
        self._proximity:   dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        # set of known fish uuids — used to prune state for deleted fish on flush
        self._known_uuids: set[str] = set()

    # ------------------------------------------------------------------

    def update_known_fish(self, fish_list: list) -> None:
        """Called by orchestrator after any fish-list refresh."""
        self._known_uuids = {f.uuid for f in fish_list}

    def prune_unknown_uuids(self, known_uuids: set[str]) -> int:
        """Drop per-fish state whose key isn't in known_uuids. Returns prune count."""
        pruned = 0
        for d in (self._zone_counts, self._speeds, self._by_hour, self._totals, self._proximity):
            for stale in [k for k in list(d.keys()) if k not in known_uuids]:
                del d[stale]
                pruned += 1
        # Proximity values are inner dicts also keyed by uuid
        for partner_map in self._proximity.values():
            for stale in [k for k in list(partner_map.keys()) if k not in known_uuids]:
                del partner_map[stale]
                pruned += 1
        return pruned

    # ------------------------------------------------------------------

    def update(self, entities: list[dict]) -> None:
        """Called every frame with identity-resolved entity list."""
        self._frame_count += 1
        hour = datetime.now().hour

        confident = []
        for e in entities:
            fid  = e["identity"].get("fish_id")
            conf = e["identity"].get("confidence", 0.0)
            if not fid or conf < 0.5:
                continue

            self._totals[fid] += 1

            for zid in e["zone_ids"]:
                self._zone_counts[fid][zid] += 1

            speed = e.get("speed_px_per_frame", 0.0)
            self._speeds[fid].append(speed)

            self._by_hour[fid][hour] += 1
            confident.append((fid, e["centroid"]))

        # Pairwise proximity tracking — O(n²) but n is always small (≤20 fish)
        for i in range(len(confident)):
            for j in range(i + 1, len(confident)):
                fid_a, (ax, ay) = confident[i]
                fid_b, (bx, by) = confident[j]
                dist = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
                if dist < _PROXIMITY_PX:
                    self._proximity[fid_a][fid_b] += 1
                    self._proximity[fid_b][fid_a] += 1

    async def maybe_flush(self, db) -> None:
        """Flush to DB every baseline_flush_interval_frames frames."""
        if self._frame_count % self._s.baseline_flush_interval_frames == 0:
            await self._flush(db)

    async def _flush(self, db) -> None:
        from sqlalchemy import select
        from convict.models.known_fish import KnownFish
        from convict.models.behavior_baseline import BehaviorBaseline

        for fid, total in self._totals.items():
            speeds = self._speeds.get(fid)
            # Gate on the actual sample count, not the frame counter — protects
            # against any drift between _totals and _speeds and ensures the
            # mean/stddev are statistically meaningful.
            if not speeds or len(speeds) < _MIN_BASELINE_SAMPLES:
                continue

            mean_spd = float(np.mean(speeds))
            std_spd  = float(np.std(speeds))
            # Belt-and-braces: never persist NaN/inf (would corrupt downstream
            # anomaly thresholds that read these as floats).
            if not (math.isfinite(mean_spd) and math.isfinite(std_spd)):
                continue

            zone_frac = {
                z: c / total
                for z, c in self._zone_counts.get(fid, {}).items()
            }

            # Proximity counts — raw frame counts per partner fish uuid
            proximity = dict(self._proximity.get(fid, {}))

            result = await db.execute(select(KnownFish).where(KnownFish.uuid == fid))
            fish   = result.scalar_one_or_none()
            if not fish:
                continue

            bl = BehaviorBaseline(
                fish_id                  = fish.id,
                computed_at              = datetime.utcnow(),
                zone_time_fractions      = json.dumps(zone_frac),
                mean_speed_px_per_frame  = mean_spd,
                speed_stddev             = std_spd,
                activity_by_hour         = json.dumps(dict(self._by_hour.get(fid, {}))),
                interaction_counts       = json.dumps(proximity),
                observation_frame_count  = total,
            )
            db.add(bl)

        # Prune in-memory state for fish that no longer exist.
        # Runs at flush cadence (every N frames) — good enough for multi-day runs.
        if self._known_uuids:
            for stale_fid in [fid for fid in list(self._totals) if fid not in self._known_uuids]:
                self._zone_counts.pop(stale_fid, None)
                self._speeds.pop(stale_fid, None)
                self._by_hour.pop(stale_fid, None)
                del self._totals[stale_fid]
                self._proximity.pop(stale_fid, None)

        try:
            await db.commit()
        except Exception:
            await db.rollback()

    # ------------------------------------------------------------------
    # Live query helpers
    # ------------------------------------------------------------------

    def speed_stats(self, fish_uuid: str) -> tuple[float, float]:
        """Returns (mean, stddev) from accumulated speed history."""
        speeds = self._speeds.get(fish_uuid, [])
        if len(speeds) < 10:
            return (0.0, 0.0)
        arr = np.array(speeds[-500:])
        return (float(arr.mean()), float(arr.std()))

    def zone_fractions(self, fish_uuid: str) -> dict[str, float]:
        total = max(self._totals.get(fish_uuid, 1), 1)
        return {z: c / total for z, c in self._zone_counts.get(fish_uuid, {}).items()}

    def proximity_counts(self, fish_uuid: str) -> dict[str, int]:
        """Raw frame counts of proximity with each partner fish uuid."""
        return dict(self._proximity.get(fish_uuid, {}))
