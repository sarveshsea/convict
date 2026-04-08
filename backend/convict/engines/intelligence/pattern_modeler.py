"""
Pattern modeler — runs every 5 minutes over recent baseline data.

Detects multi-fish behavioral patterns using cross-correlation, zone
co-occurrence, circadian rhythm analysis, proximity data, and coloration shifts.

Pattern types:
  schooling           — multiple fish show correlated speed changes
  territory_defense   — one fish shows high speed + zone exclusivity
  circadian_deviation — fish active/inactive at unexpected hours vs baseline
  pair_bonding        — two fish consistently proximate, low aggression between them
  prespawn_coloration — HSV histogram of fish has shifted toward orange/red vs baseline
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from collections import defaultdict, deque

import numpy as np


class PatternModeler:
    def __init__(self, settings, known_fish: list, baseline_builder):
        self._s        = settings
        self._fish     = known_fish
        self._baseline = baseline_builder

        # fish_uuid → deque of recent HSV histogram bytes (from identity_resolver)
        # Updated per-frame by orchestrator when a fish is identified at ≥0.65 conf
        self._color_obs: dict[str, deque] = defaultdict(lambda: deque(maxlen=30))

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def record_color_observation(self, fish_uuid: str, histogram_bytes: bytes) -> None:
        """
        Called by orchestrator every frame for each confidently-identified fish.
        Stores the raw HSV histogram bytes so _detect_prespawn_coloration can
        compare them against the stored baseline at the next run().
        """
        self._color_obs[fish_uuid].append(histogram_bytes)

    async def run(self, db) -> list[dict]:
        """
        Analyse current baselines; write new patterns to DB.
        Returns list of pattern dicts for WS broadcast (may be empty).
        """
        patterns: list[dict] = []

        patterns += await self._detect_schooling(db)
        patterns += await self._detect_territory_defense(db)
        patterns += await self._detect_circadian_deviation(db)
        patterns += await self._detect_pair_bonding(db)
        patterns += await self._detect_prespawn_coloration(db)

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

    async def _detect_circadian_deviation(self, db) -> list[dict]:
        """
        Compares each fish's live activity fraction for the current hour against
        its stored activity_by_hour baseline.

        A fish that is historically very active at hour H but is barely seen now
        (or vice versa) gets a circadian_deviation pattern written.  This can be
        caused by stress, illness, environmental disruption, or a light-cycle change.
        """
        import json
        from datetime import datetime
        from sqlalchemy import select, desc
        from convict.models.behavior_baseline import BehaviorBaseline

        current_hour = datetime.now().hour
        results: list[dict] = []

        for fish in self._fish:
            # Latest stored baseline from DB
            row = (await db.execute(
                select(BehaviorBaseline)
                .where(BehaviorBaseline.fish_id == fish.id)
                .order_by(desc(BehaviorBaseline.computed_at))
                .limit(1)
            )).scalar_one_or_none()

            if not row or not row.activity_by_hour:
                continue
            try:
                by_hour = json.loads(row.activity_by_hour)
            except Exception:
                continue

            hours = [float(by_hour.get(str(i), 0)) for i in range(24)]
            total = sum(hours)
            if total < 100:  # insufficient historical data
                continue

            # Only bother if there IS a meaningful circadian pattern
            # (coefficient of variation across hours must be noticeable)
            arr = np.array(hours)
            mean_h = arr.mean()
            if mean_h <= 0 or arr.std() / mean_h < 0.30:
                continue

            expected_frac = hours[current_hour] / total

            # Live fraction: how much of this session the fish was seen this hour
            live_hour  = float(self._baseline._by_hour.get(fish.uuid, {}).get(current_hour, 0))
            live_total = float(self._baseline._totals.get(fish.uuid, 1))
            if live_total < 30:
                continue
            live_frac = live_hour / live_total

            # Flag if the fish is significantly over- or under-active vs expectation
            expected_state = "active" if expected_frac > (1 / 24 * 1.5) else "inactive"
            if expected_state == "active" and live_frac < expected_frac * 0.30:
                deviation = "unexpectedly_inactive"
            elif expected_state == "inactive" and live_frac > expected_frac * 2.50:
                deviation = "unexpectedly_active"
            else:
                continue

            delta = abs(expected_frac - live_frac)
            p = await self._upsert_pattern(
                db,
                fish_id      = fish.uuid,
                pattern_type = "circadian_deviation",
                signature    = {
                    "current_hour":   current_hour,
                    "deviation":      deviation,
                    "expected_frac":  round(expected_frac, 3),
                    "live_frac":      round(live_frac, 3),
                },
                confidence   = round(min(0.85, delta / max(expected_frac, 0.01)), 2),
            )
            if p:
                results.append(p)

        return results

    async def _detect_pair_bonding(self, db) -> list[dict]:
        """
        Detects fish pairs with sustained proximity (> 150 frames) and low
        inter-pair aggression — characteristic of pair bonding or tight shoaling.

        Uses the live baseline proximity counts plus recent interaction edges to
        distinguish bonded pairs from proximity that is actually conflict-driven.
        """
        from datetime import timedelta, datetime as _dt
        from sqlalchemy import select
        from convict.models.interaction_edge import InteractionEdge
        from convict.models.known_fish import KnownFish

        results: list[dict] = []
        seen_pairs: set[tuple[str, str]] = set()

        for fish in self._fish:
            prox = self._baseline.proximity_counts(fish.uuid)
            if not prox:
                continue

            for partner_uuid, frame_count in prox.items():
                if frame_count < 150:
                    continue

                pair_key = tuple(sorted([fish.uuid, partner_uuid]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                partner = next((f for f in self._fish if f.uuid == partner_uuid), None)
                if not partner:
                    continue

                # Canonical ordering by DB id
                id_a = min(fish.id, partner.id)
                id_b = max(fish.id, partner.id)

                # Count harassment edges between this pair in last 48h
                since = _dt.utcnow() - timedelta(hours=48)
                harassment_edges = (await db.execute(
                    select(InteractionEdge).where(
                        InteractionEdge.fish_a_id        == id_a,
                        InteractionEdge.fish_b_id        == id_b,
                        InteractionEdge.interaction_type == "harassment",
                        InteractionEdge.occurred_at      >= since,
                    )
                )).scalars().all()

                if len(harassment_edges) > 5:
                    continue  # too much aggression — not a bond

                confidence = round(min(0.80, (frame_count - 150) / 500 + 0.30), 2)

                p = await self._upsert_pattern(
                    db,
                    fish_id      = fish.uuid,
                    pattern_type = "pair_bonding",
                    signature    = {
                        "partner_uuid":      partner_uuid,
                        "partner_name":      partner.name,
                        "proximity_frames":  frame_count,
                        "harassment_count":  len(harassment_edges),
                    },
                    confidence   = confidence,
                )
                if p:
                    results.append(p)

        return results

    async def _detect_prespawn_coloration(self, db) -> list[dict]:
        """
        Compares each fish's recent HSV color histogram against the stored
        baseline. A shift of hue weight toward orange/red (OpenCV H ≈ 0-20
        and 155-180) relative to baseline signals pre-spawn coloration change —
        common in cichlids, bettas, many tetras, and livebearers before spawning.

        Requires:
          • ≥15 recent color observations accumulated since last run()
          • A stored color_histogram in KnownFish (set by identity_resolver)
          • A meaningful hue shift score > 0.08 (8% of histogram mass moved
            toward warm hues relative to baseline)
        """
        results: list[dict] = []

        for fish in self._fish:
            obs = self._color_obs.get(fish.uuid)
            if not obs or len(obs) < 15:
                continue
            if fish.color_histogram is None:
                continue

            # Stored baseline histogram (18×16 = 288 bins, H×S)
            stored = np.frombuffer(fish.color_histogram, dtype=np.float32)
            if stored.shape[0] != 288:
                continue

            # Average the recent observations
            recent_arrays = []
            for hb in obs:
                arr = np.frombuffer(hb, dtype=np.float32)
                if arr.shape[0] == 288:
                    recent_arrays.append(arr)
            if len(recent_arrays) < 10:
                continue
            recent = np.mean(recent_arrays, axis=0)

            # The histogram is 18×16: 18 hue bins × 16 saturation bins.
            # Bin 0 = H 0-10°, bin 17 = H 170-180°.
            # "Warm" = bins 0-1 (red-orange) and bin 17 (wraps back to red).
            hist_2d_stored = stored.reshape(18, 16)
            hist_2d_recent = recent.reshape(18, 16)

            # Sum saturation axis → 18-element hue profile
            hue_stored = hist_2d_stored.sum(axis=1)
            hue_recent = hist_2d_recent.sum(axis=1)

            # Warm-hue mass = bins 0, 1, 17 (0-20° and 170-180°)
            warm_idx = [0, 1, 17]
            warm_stored = float(hue_stored[warm_idx].sum())
            warm_recent = float(hue_recent[warm_idx].sum())

            # Shift score: how much more warm-hue mass relative to baseline
            shift = warm_recent - warm_stored   # signed; positive = warmer
            if shift <= 0.08:
                continue

            # Also require that the fish has a reasonably high saturation
            # (pre-spawn coloration = vivid, not just washed-out noise)
            sat_profile_recent = recent.reshape(18, 16).sum(axis=0)
            high_sat = float(sat_profile_recent[8:].sum())   # top half of sat range
            if high_sat < 0.15:
                continue

            p = await self._upsert_pattern(
                db,
                fish_id      = fish.uuid,
                pattern_type = "prespawn_coloration",
                signature    = {
                    "warm_hue_shift":  round(shift, 3),
                    "warm_frac_now":   round(warm_recent, 3),
                    "warm_frac_base":  round(warm_stored, 3),
                    "high_sat_frac":   round(high_sat, 3),
                },
                confidence   = round(min(shift / 0.25, 0.90), 2),
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
