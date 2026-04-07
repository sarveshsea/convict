"""
Prediction engine — runs every prediction_interval_seconds (default 5min).

Scans recent anomaly events and baseline drift, then writes Prediction +
EvidenceBundle records to DB and broadcasts prediction_created WS messages.

Prediction types:
  aggression_escalation — ≥N harassment events in the window
  isolation_trend       — ≥N hiding/missing events for the same fish
  territory_shift       — fish consistently outside its expected zone
  feeding_disruption    — fish not seen during/after scheduled feeding
"""
from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from convict.engines.intelligence.anomaly_detector import AnomalyDetector
    from convict.engines.intelligence.baseline_builder  import BaselineBuilder
    from convict.engines.intelligence.identity_resolver import IdentityResolver


# Template-based narrative strings
_NARRATIVES: dict[str, str] = {
    "aggression_escalation":
        "{count} harassment events detected in the last {window}min. "
        "Escalating aggression between {fish} is likely.",
    "isolation_trend":
        "{fish} has been absent from its expected zone {count} times recently. "
        "Hiding or illness behaviour is forming.",
    "territory_shift":
        "{fish} is spending significantly less time in its established zone. "
        "A territory realignment may be underway.",
    "feeding_disruption":
        "{fish} showed reduced activity during the recent feeding window. "
        "Appetite or dominance suppression is possible.",
}


class PredictionEngine:
    def __init__(
        self,
        settings,
        known_fish: list,
        anomaly_detector: "AnomalyDetector",
        baseline_builder: "BaselineBuilder",
        identity_resolver: "IdentityResolver",
    ):
        self._s        = settings
        self._fish     = known_fish
        self._anomaly  = anomaly_detector
        self._baseline = baseline_builder
        self._resolver = identity_resolver

        # Rolling event log — anomaly_detector appends here via hook
        self._recent_events: list[dict] = []
        # Track which predictions have been created to avoid duplicates in window
        self._active_types: set[str] = set()

    # ------------------------------------------------------------------

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def record_event(self, event: dict) -> None:
        """Called by orchestrator whenever anomaly_detector emits an event."""
        self._recent_events.append(event)
        # Keep last 200 events in memory
        if len(self._recent_events) > 200:
            self._recent_events = self._recent_events[-100:]

    async def run(self, db) -> list[dict]:
        """
        Evaluate prediction rules; write to DB; return broadcast payloads.
        Call every prediction_interval_seconds from orchestrator.
        """
        # Auto-expire old active predictions
        await self._expire_old(db)
        self._active_types.clear()

        predictions: list[dict] = []
        window_min  = self._s.prediction_interval_seconds // 60
        thresh      = self._s.aggression_streak_threshold

        # Count event types per fish in rolling window
        counts_by_type: dict[str, int]               = defaultdict(int)
        fish_counts:    dict[str, dict[str, int]]     = defaultdict(lambda: defaultdict(int))

        for ev in self._recent_events:
            counts_by_type[ev["event_type"]] += 1
            for fi in ev.get("involved_fish", []):
                fish_counts[ev["event_type"]][fi["fish_id"]] += 1

        # ── Rule 1: aggression_escalation ──────────────────────────────
        if counts_by_type.get("harassment", 0) >= thresh:
            # Find the most-involved fish pair
            top_fish = sorted(fish_counts["harassment"].items(), key=lambda x: -x[1])[:2]
            involved = self._fish_refs([fid for fid, _ in top_fish])
            count    = counts_by_type["harassment"]
            payload  = await self._create_prediction(
                db,
                prediction_type = "aggression_escalation",
                horizon_minutes = 30,
                confidence      = min(0.95, 0.5 + count * 0.1),
                involved        = involved,
                narrative       = _NARRATIVES["aggression_escalation"].format(
                    count=count, window=window_min,
                    fish=" & ".join(f["fish_name"] for f in involved) or "multiple fish",
                ),
                event_type = "harassment",
            )
            if payload:
                predictions.append(payload)

        # ── Rule 2: isolation_trend ────────────────────────────────────
        iso_thresh = self._s.isolation_window_threshold
        for fid, cnt in fish_counts.get("missing_fish", {}).items():
            if cnt >= iso_thresh:
                involved = self._fish_refs([fid])
                payload  = await self._create_prediction(
                    db,
                    prediction_type = "isolation_trend",
                    horizon_minutes = 60,
                    confidence      = min(0.90, 0.4 + cnt * 0.15),
                    involved        = involved,
                    narrative       = _NARRATIVES["isolation_trend"].format(
                        fish=involved[0]["fish_name"] if involved else "A fish",
                        count=cnt,
                    ),
                    event_type = "missing_fish",
                )
                if payload:
                    predictions.append(payload)

        # ── Rule 3: territory_shift ────────────────────────────────────
        for fish in self._fish:
            fracs = self._baseline.zone_fractions(fish.uuid)
            if not fracs:
                continue
            preferred = json.loads(fish.preferred_zones or "[]")
            if not preferred:
                continue
            pref_time = sum(fracs.get(z, 0.0) for z in preferred)
            if pref_time < 0.25:   # spending <25% of time in preferred zone
                involved = self._fish_refs([fish.uuid])
                payload  = await self._create_prediction(
                    db,
                    prediction_type = "territory_shift",
                    horizon_minutes = 45,
                    confidence      = round(min(0.85, (0.25 - pref_time) * 4), 2),
                    involved        = involved,
                    narrative       = _NARRATIVES["territory_shift"].format(
                        fish=fish.name,
                    ),
                    event_type = "zone_deviation",
                )
                if payload:
                    predictions.append(payload)

        return predictions

    # ------------------------------------------------------------------

    def _fish_refs(self, fish_ids: list[str]) -> list[dict]:
        fish_map = {f.uuid: f.name for f in self._fish}
        return [{"fish_id": fid, "fish_name": fish_map.get(fid, "Unknown")} for fid in fish_ids]

    async def _create_prediction(
        self,
        db,
        prediction_type: str,
        horizon_minutes: int,
        confidence: float,
        involved: list[dict],
        narrative: str,
        event_type: str,
    ) -> dict | None:
        from sqlalchemy import select
        from convict.models.prediction import Prediction
        from convict.models.evidence_bundle import EvidenceBundle
        from convict.engines.knowledge.tank_knowledge_engine import get_tank

        if prediction_type in self._active_types:
            return None
        self._active_types.add(prediction_type)

        tank = await get_tank(db)
        if not tank:
            return None

        # Check no active prediction of this type already
        existing = await db.execute(
            select(Prediction).where(
                Prediction.tank_id         == tank.id,
                Prediction.prediction_type == prediction_type,
                Prediction.status          == "active",
            )
        )
        if existing.scalar_one_or_none():
            return None

        now        = datetime.utcnow()
        expires_at = now + timedelta(minutes=horizon_minutes)
        pred_uuid  = str(uuid.uuid4())

        pred = Prediction(
            uuid            = pred_uuid,
            tank_id         = tank.id,
            prediction_type = prediction_type,
            horizon_minutes = horizon_minutes,
            confidence      = confidence,
            status          = "active",
            involved_fish   = json.dumps(involved),
            expires_at      = expires_at,
        )
        db.add(pred)
        await db.flush()   # get pred.id before creating bundle

        bundle_uuid = str(uuid.uuid4())
        bundle = EvidenceBundle(
            uuid             = bundle_uuid,
            prediction_id    = pred.id,
            bundle_type      = "anomaly_chain",
            supporting_events= json.dumps([e["uuid"] for e in self._recent_events[-10:]]),
            narrative        = narrative,
        )
        db.add(bundle)

        try:
            await db.commit()
        except Exception:
            await db.rollback()
            return None

        return {
            "uuid":               pred_uuid,
            "prediction_type":    prediction_type,
            "confidence":         confidence,
            "horizon_minutes":    horizon_minutes,
            "involved_fish":      involved,
            "narrative":          narrative,
            "evidence_bundle_id": bundle_uuid,
            "expires_at":         expires_at.replace(tzinfo=timezone.utc).isoformat(),
            "status":             "active",
        }

    async def _expire_old(self, db) -> None:
        from sqlalchemy import select, update
        from convict.models.prediction import Prediction

        now = datetime.utcnow()
        await db.execute(
            update(Prediction)
            .where(Prediction.status == "active", Prediction.expires_at < now)
            .values(status="expired")
        )
        try:
            await db.commit()
        except Exception:
            await db.rollback()
