"""
Pattern modeler — runs every 5 minutes over recent baseline data.

Detects multi-fish behavioral patterns using cross-correlation and
zone co-occurrence, then writes them to behavior_patterns.

Pattern types:
  schooling         — multiple fish show correlated speed changes
  territory_defense — one fish shows high speed + zone exclusivity
  post_feeding_patrol — elevated activity in feeding zones post-schedule
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np


class PatternModeler:
    def __init__(self, settings, known_fish: list, baseline_builder):
        self._s        = settings
        self._fish     = known_fish
        self._baseline = baseline_builder

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    async def run(self, db) -> list[dict]:
        """
        Analyse current baselines; write new patterns to DB.
        Returns list of pattern dicts for WS broadcast (may be empty).
        """
        patterns: list[dict] = []

        patterns += await self._detect_schooling(db)
        patterns += await self._detect_territory_defense(db)

        return patterns

    # ------------------------------------------------------------------

    async def _detect_schooling(self, db) -> list[dict]:
        """
        Schooling: ≥2 fish have highly correlated speed time-series
        (Pearson r > 0.75) over the last 500 frames.
        """
        if len(self._fish) < 2:
            return []

        speed_series: dict[str, list[float]] = {}
        for fish in self._fish:
            speeds = self._baseline._speeds.get(fish.uuid, [])
            if len(speeds) >= 50:
                speed_series[fish.uuid] = speeds[-500:]

        if len(speed_series) < 2:
            return []

        results: list[dict] = []
        ids = list(speed_series.keys())
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a = np.array(speed_series[ids[i]])
                b = np.array(speed_series[ids[j]])
                # Align lengths
                n = min(len(a), len(b))
                a, b = a[-n:], b[-n:]
                if n < 30:
                    continue
                corr = float(np.corrcoef(a, b)[0, 1])
                if corr > 0.75:
                    fish_a = next((f for f in self._fish if f.uuid == ids[i]), None)
                    fish_b = next((f for f in self._fish if f.uuid == ids[j]), None)
                    if fish_a and fish_b:
                        p = await self._upsert_pattern(
                            db,
                            fish_id=fish_a.uuid,
                            pattern_type="schooling",
                            signature={"corr": round(corr, 3), "partner_uuid": fish_b.uuid, "partner_name": fish_b.name},
                            confidence=round((corr - 0.75) / 0.25, 2),  # scale 0.75-1.0 → 0-1
                        )
                        if p:
                            results.append(p)

        return results

    async def _detect_territory_defense(self, db) -> list[dict]:
        """
        Territory defense: a fish spends >70% of frames in a single zone
        AND has above-average speed (active patrolling, not just resting).
        """
        results: list[dict] = []

        for fish in self._fish:
            fracs = self._baseline.zone_fractions(fish.uuid)
            if not fracs:
                continue
            dominant_zone, frac = max(fracs.items(), key=lambda x: x[1])
            if frac < 0.70:
                continue

            mean_speed, _ = self._baseline.speed_stats(fish.uuid)
            # Compute mean across all fish for comparison
            all_means = [
                self._baseline.speed_stats(f.uuid)[0]
                for f in self._fish if self._baseline.speed_stats(f.uuid)[0] > 0
            ]
            if not all_means:
                continue
            global_mean = float(np.mean(all_means))
            if mean_speed < global_mean * 1.15:
                continue  # not markedly faster than average

            p = await self._upsert_pattern(
                db,
                fish_id=fish.uuid,
                pattern_type="territory_defense",
                signature={"zone_uuid": dominant_zone, "zone_frac": round(frac, 2), "mean_speed": round(mean_speed, 2)},
                confidence=round(min((frac - 0.70) / 0.30, 1.0), 2),
            )
            if p:
                results.append(p)

        return results

    # ------------------------------------------------------------------

    async def _upsert_pattern(self, db, fish_id: str, pattern_type: str,
                               signature: dict, confidence: float) -> dict | None:
        from sqlalchemy import select
        from convict.models.behavior_pattern import BehaviorPattern
        from convict.models.known_fish import KnownFish
        from convict.engines.knowledge.tank_knowledge_engine import get_tank

        result = await db.execute(select(KnownFish).where(KnownFish.uuid == fish_id))
        fish   = result.scalar_one_or_none()
        if not fish:
            return None

        tank = await get_tank(db)
        if not tank:
            return None

        # Check for existing active pattern
        existing = await db.execute(
            select(BehaviorPattern).where(
                BehaviorPattern.fish_id      == fish.id,
                BehaviorPattern.pattern_type == pattern_type,
            )
        )
        row = existing.scalar_one_or_none()

        now = datetime.utcnow()
        if row:
            row.confidence       = confidence
            row.signature        = json.dumps(signature)
            row.last_seen_at     = now
            row.occurrence_count += 1
        else:
            row = BehaviorPattern(
                uuid             = str(uuid.uuid4()),
                fish_id          = fish.id,
                tank_id          = tank.id,
                pattern_type     = pattern_type,
                signature        = json.dumps(signature),
                confidence       = confidence,
                first_seen_at    = now,
                last_seen_at     = now,
                occurrence_count = 1,
            )
            db.add(row)

        try:
            await db.commit()
            await db.refresh(row)
        except Exception:
            await db.rollback()
            return None

        return {
            "uuid":          row.uuid,
            "fish_id":       fish_id,
            "fish_name":     fish.name,
            "pattern_type":  pattern_type,
            "confidence":    confidence,
            "signature":     signature,
        }
