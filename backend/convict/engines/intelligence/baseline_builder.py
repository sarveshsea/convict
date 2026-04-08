"""
Behavioral baseline builder.

Per-frame: accumulates zone time, speed, and activity-by-hour stats for
each identified fish (confidence >= 0.5 only).

Every baseline_flush_interval_frames: writes a snapshot to behavior_baselines.
"""
from __future__ import annotations

import json
from collections import defaultdict, deque
from datetime import datetime

import numpy as np


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

    # ------------------------------------------------------------------

    def update(self, entities: list[dict]) -> None:
        """Called every frame with identity-resolved entity list."""
        self._frame_count += 1
        hour = datetime.now().hour

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

    async def maybe_flush(self, db) -> None:
        """Flush to DB every baseline_flush_interval_frames frames."""
        if self._frame_count % self._s.baseline_flush_interval_frames == 0:
            await self._flush(db)

    async def _flush(self, db) -> None:
        from sqlalchemy import select
        from convict.models.known_fish import KnownFish
        from convict.models.behavior_baseline import BehaviorBaseline

        for fid, total in self._totals.items():
            if total < 30:
                continue  # not enough data for a meaningful baseline

            speeds   = self._speeds.get(fid, [])
            mean_spd = float(np.mean(speeds)) if speeds else 0.0
            std_spd  = float(np.std(speeds))  if len(speeds) > 1 else 0.0

            zone_frac = {
                z: c / total
                for z, c in self._zone_counts.get(fid, {}).items()
            }

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
                interaction_counts       = json.dumps({}),
                observation_frame_count  = total,
            )
            db.add(bl)

        try:
            await db.commit()
        except Exception:
            await db.rollback()

    # ------------------------------------------------------------------
    # Live query helpers (used by anomaly detector)
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
