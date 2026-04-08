"""
Community health scorer.

Runs every prediction_interval_seconds alongside the prediction engine.
Reads the last hour of behavior_events from DB + live baseline state to
produce a 0.0–1.0 tank wellbeing score with four components:

  aggression_rate  (35%) — harassment events per hour; 0/hr = 1.0, ≥3/hr = 0.0
  social_cohesion  (25%) — schooling pattern confidence + inter-fish proximity
  zone_stability   (20%) — fish found in preferred zones vs displaced
  isolation_index  (20%) — missing_fish + lethargy events per hour; 0/hr = 1.0

Persists CommunityHealthSnapshot and broadcasts a "community_health" WS message.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger("convict.health")

# Component weights (must sum to 1.0)
_W_AGGRESSION = 0.35
_W_COHESION   = 0.25
_W_STABILITY  = 0.20
_W_ISOLATION  = 0.20

# Caps for normalization
_HARASSMENT_CAP = 3.0   # events/hr at which aggression_rate = 0
_ISOLATION_CAP  = 5.0   # events/hr at which isolation_index = 0


class CommunityHealthScorer:
    def __init__(self, settings, known_fish: list, baseline_builder):
        self._s        = settings
        self._fish     = known_fish
        self._baseline = baseline_builder

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    async def run(self, db) -> dict | None:
        """
        Compute health score, persist snapshot, return broadcast payload.
        Returns None if insufficient data (e.g. no tank, no fish).
        """
        from sqlalchemy import select, func, desc
        from convict.models.behavior_event import BehaviorEvent
        from convict.models.behavior_pattern import BehaviorPattern
        from convict.models.community_health_snapshot import CommunityHealthSnapshot
        from convict.engines.knowledge.tank_knowledge_engine import get_tank

        tank = await get_tank(db)
        if not tank or not self._fish:
            return None

        now      = datetime.utcnow()
        one_hour = now - timedelta(hours=1)

        # ── Fetch last hour of events ──────────────────────────────────
        rows = (await db.execute(
            select(BehaviorEvent)
            .where(
                BehaviorEvent.tank_id    == tank.id,
                BehaviorEvent.occurred_at >= one_hour,
            )
        )).scalars().all()

        harassment_count = sum(1 for r in rows if r.event_type == "harassment")
        lethargy_count   = sum(1 for r in rows if r.event_type == "lethargy")
        missing_count    = sum(1 for r in rows if r.event_type == "missing_fish")

        # ── Aggression component ───────────────────────────────────────
        aggression_rate = min(harassment_count / _HARASSMENT_CAP, 1.0)
        aggression_score = round(1.0 - aggression_rate, 3)

        # ── Isolation component ────────────────────────────────────────
        isolation_events = lethargy_count + missing_count
        isolation_rate   = min(isolation_events / _ISOLATION_CAP, 1.0)
        isolation_score  = round(1.0 - isolation_rate, 3)

        # ── Social cohesion component ──────────────────────────────────
        # From behavior_patterns: average schooling confidence across fish
        schooling_rows = (await db.execute(
            select(BehaviorPattern)
            .where(
                BehaviorPattern.tank_id      == tank.id,
                BehaviorPattern.pattern_type == "schooling",
            )
        )).scalars().all()

        if schooling_rows:
            avg_schooling = sum(r.confidence for r in schooling_rows) / len(schooling_rows)
        else:
            avg_schooling = 0.0

        # Visibility ratio: fraction of known fish seen in baseline
        seen_fish = sum(
            1 for f in self._fish
            if self._baseline._totals.get(f.uuid, 0) > 0
        )
        visibility_ratio = seen_fish / max(len(self._fish), 1)

        cohesion_score = round(avg_schooling * 0.6 + visibility_ratio * 0.4, 3)

        # ── Zone stability component ───────────────────────────────────
        stability_scores = []
        for fish in self._fish:
            preferred = json.loads(getattr(fish, "preferred_zones", None) or "[]")
            if not preferred:
                stability_scores.append(1.0)  # no preference = always stable
                continue
            fracs = self._baseline.zone_fractions(fish.uuid)
            pref_time = sum(fracs.get(z, 0.0) for z in preferred)
            # pref_time = 1.0 means always in preferred zone (perfect)
            stability_scores.append(min(pref_time / 0.5, 1.0))  # 50%+ in zone = max score

        zone_stability = round(
            sum(stability_scores) / max(len(stability_scores), 1), 3
        )

        # ── Final weighted score ───────────────────────────────────────
        score = round(
            _W_AGGRESSION * aggression_score
            + _W_COHESION  * cohesion_score
            + _W_STABILITY * zone_stability
            + _W_ISOLATION * isolation_score,
            3,
        )

        components = {
            "aggression_rate": aggression_score,
            "social_cohesion": cohesion_score,
            "zone_stability":  zone_stability,
            "isolation_index": isolation_score,
        }

        # ── Persist snapshot ───────────────────────────────────────────
        snapshot = CommunityHealthSnapshot(
            tank_id    = tank.id,
            computed_at= now,
            score      = score,
            components = json.dumps(components),
        )
        db.add(snapshot)
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            log.exception("Failed to persist community health snapshot")

        log.debug(
            "Community health: %.2f  (agg=%.2f coh=%.2f stab=%.2f iso=%.2f)",
            score, aggression_score, cohesion_score, zone_stability, isolation_score,
        )

        return {
            "score":      score,
            "components": components,
            "fish_count": len(self._fish),
            "computed_at": now.replace(tzinfo=timezone.utc).isoformat(),
        }
