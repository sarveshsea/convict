"""
Prediction engine — runs every prediction_interval_seconds (default 5min).

Scans recent anomaly events and baseline drift, then writes Prediction +
EvidenceBundle records to DB and broadcasts prediction_created WS messages.

Prediction types
────────────────
Existing:
  aggression_escalation — ≥N harassment events in the window
  isolation_trend       — ≥N hiding/missing events for the same fish
  territory_shift       — fish consistently outside its expected zone

New (vision-only water quality + health signals):
  water_quality_alert   — ≥50 % of fish simultaneously stressed (O₂/NH₃/temp proxy)
  disease_early_warning — individual fish: lethargy + absence + zone abandonment
  feeding_disruption    — fish absent/lethargic near a feeding schedule event
  spawning_imminent     — territory defense + pair bonding for the same fish
  circadian_disruption  — multiple fish showing circadian_deviation patterns
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


_NARRATIVES: dict[str, str] = {
    # ── Existing ──────────────────────────────────────────────────────────────
    "aggression_escalation":
        "{count} harassment events in the last {window}min. "
        "Escalating aggression between {fish} is likely.",

    "isolation_trend":
        "{fish} has been absent from its expected zone {count} times recently. "
        "Hiding or illness behaviour is forming.",

    "territory_shift":
        "{fish} is spending significantly less time in its established zone. "
        "A territory realignment may be underway.",

    # ── New ───────────────────────────────────────────────────────────────────
    "water_quality_alert":
        "{count} of {total} fish showing simultaneous behavioral stress. "
        "Check dissolved oxygen, ammonia/nitrite and temperature immediately.",

    "disease_early_warning":
        "{fish} is showing multiple stress indicators: {signals}. "
        "Early disease or isolation behaviour detected — monitor closely.",

    "feeding_disruption":
        "{fish} showed reduced presence after the recent {event_type} event. "
        "Appetite decline or feeding suppression may be occurring.",

    "spawning_imminent":
        "{fish} is showing territory defense combined with sustained pair proximity. "
        "Spawning or breeding behaviour is likely within the next 24 hours.",

    "circadian_disruption":
        "{count} fish showing activity patterns inconsistent with their established "
        "circadian rhythms. Environmental stress or light-cycle disruption is possible.",
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
        # Dedup guard — cleared at the start of each run() cycle
        self._active_types: set[str] = set()

    # ------------------------------------------------------------------

    def update_known_fish(self, fish: list) -> None:
        self._fish = fish

    def record_event(self, event: dict) -> None:
        """Called by orchestrator whenever anomaly_detector emits an event."""
        self._recent_events.append(event)
        if len(self._recent_events) > 200:
            self._recent_events = self._recent_events[-100:]

    async def run(self, db, schedules: list | None = None) -> list[dict]:
        """
        Evaluate all prediction rules; write to DB; return broadcast payloads.
        Call every prediction_interval_seconds from orchestrator.

        :param schedules: Optional list of TankSchedule ORM objects for feeding-
                          disruption detection.  Pass None if not available.
        """
        await self._expire_old(db)
        self._active_types.clear()

        predictions: list[dict] = []
        window_min  = self._s.prediction_interval_seconds // 60
        thresh      = self._s.aggression_streak_threshold

        # ── Aggregate event counts across the recent window ───────────
        counts_by_type: dict[str, int]           = defaultdict(int)
        fish_counts:    dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for ev in self._recent_events:
            counts_by_type[ev["event_type"]] += 1
            for fi in ev.get("involved_fish", []):
                fish_counts[ev["event_type"]][fi["fish_id"]] += 1

        # ── Rule 1: aggression_escalation ─────────────────────────────
        if counts_by_type.get("harassment", 0) >= thresh:
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

        # ── Rule 2: isolation_trend ───────────────────────────────────
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

        # ── Rule 3: territory_shift ───────────────────────────────────
        for fish in self._fish:
            fracs     = self._baseline.zone_fractions(fish.uuid)
            preferred = json.loads(fish.preferred_zones or "[]")
            if not fracs or not preferred:
                continue
            pref_time = sum(fracs.get(z, 0.0) for z in preferred)
            if pref_time < 0.25:
                involved = self._fish_refs([fish.uuid])
                payload  = await self._create_prediction(
                    db,
                    prediction_type = "territory_shift",
                    horizon_minutes = 45,
                    confidence      = round(min(0.85, (0.25 - pref_time) * 4), 2),
                    involved        = involved,
                    narrative       = _NARRATIVES["territory_shift"].format(fish=fish.name),
                    event_type      = "zone_deviation",
                )
                if payload:
                    predictions.append(payload)

        # ── Rule 4: water_quality_alert ───────────────────────────────
        # Triggered by:
        #   • synchronized_stress event (explicit multi-fish flag)
        #   • surface_gathering event (fish at the surface = low O₂)
        #   • ≥50% of fish showing lethargy or hyperactivity simultaneously
        sync_count    = counts_by_type.get("synchronized_stress", 0)
        surface_count = counts_by_type.get("surface_gathering", 0)
        stress_fish   = (set(fish_counts.get("lethargy", {}).keys()) |
                         set(fish_counts.get("hyperactivity", {}).keys()))

        wq_triggered = (
            sync_count >= 1
            or surface_count >= 1
            or len(stress_fish) >= max(2, len(self._fish) // 2)
        )
        if wq_triggered:
            count    = max(sync_count + surface_count, len(stress_fish))
            total    = max(len(self._fish), 1)
            conf     = round(min(0.95, 0.50 + count * 0.08), 2)
            involved = self._fish_refs(list(stress_fish)[:6])
            if not involved:
                # Fall back to fish involved in any recent high-severity event
                seen_fids: list[str] = []
                for ev in reversed(self._recent_events[-10:]):
                    for f in ev.get("involved_fish", []):
                        if f["fish_id"] not in seen_fids:
                            seen_fids.append(f["fish_id"])
                involved = self._fish_refs(seen_fids[:6])
            payload = await self._create_prediction(
                db,
                prediction_type = "water_quality_alert",
                horizon_minutes = 15,
                confidence      = conf,
                involved        = involved,
                narrative       = _NARRATIVES["water_quality_alert"].format(
                    count=count, total=total,
                ),
                event_type = "synchronized_stress",
            )
            if payload:
                predictions.append(payload)

        # ── Rule 5: disease_early_warning ─────────────────────────────
        # Multi-evidence scoring per individual fish.
        # Score ≥ 4 triggers a warning prediction.
        for fish in self._fish:
            score   = 0
            signals: list[str] = []

            fish_events = [
                ev for ev in self._recent_events
                if any(f["fish_id"] == fish.uuid for f in ev.get("involved_fish", []))
            ]
            lethargy_cnt = sum(1 for ev in fish_events if ev["event_type"] == "lethargy")
            missing_cnt  = sum(1 for ev in fish_events if ev["event_type"] == "missing_fish")
            erratic_cnt  = sum(1 for ev in fish_events if ev["event_type"] == "erratic_motion")

            if lethargy_cnt >= 2: score += 2; signals.append(f"lethargic ×{lethargy_cnt}")
            if missing_cnt  >= 2: score += 2; signals.append(f"absent ×{missing_cnt}")
            if erratic_cnt  >= 1: score += 2; signals.append("erratic swimming")

            # Zone abandonment adds evidence
            preferred = json.loads(fish.preferred_zones or "[]")
            if preferred:
                fracs     = self._baseline.zone_fractions(fish.uuid)
                pref_time = sum(fracs.get(z, 0.0) for z in preferred)
                if pref_time < 0.15:
                    score += 2; signals.append("zone abandoned")

            if score >= 4:
                involved = self._fish_refs([fish.uuid])
                payload  = await self._create_prediction(
                    db,
                    prediction_type = "disease_early_warning",
                    horizon_minutes = 120,
                    confidence      = round(min(0.85, 0.30 + score * 0.08), 2),
                    involved        = involved,
                    narrative       = _NARRATIVES["disease_early_warning"].format(
                        fish=fish.name,
                        signals=", ".join(signals),
                    ),
                    event_type = "lethargy",
                )
                if payload:
                    predictions.append(payload)
                break  # one disease warning per cycle to avoid notification flood

        # ── Rule 6: feeding_disruption ────────────────────────────────
        # Check if any fish was absent or lethargic 5–30 minutes after a feeding
        # schedule event that should have occurred today.
        if schedules:
            now   = datetime.now()
            today = now.strftime("%a").lower()
            for s in schedules:
                if s.event_type not in ("feeding", "feed"):
                    continue
                days = s.days_of_week if isinstance(s.days_of_week, list) else []
                if days and today not in [d.lower()[:3] for d in days]:
                    continue
                try:
                    h, m = map(int, s.time_of_day.split(":"))
                except Exception:
                    continue
                now_min  = now.hour * 60 + now.minute
                feed_min = h * 60 + m
                offset   = now_min - feed_min   # positive = feeding was N min ago
                if not (5 <= offset <= 30):
                    continue

                # Fish that showed missing or lethargy near feeding time
                disrupted: list = []
                for fish in self._fish:
                    fish_events = [
                        ev for ev in self._recent_events
                        if (any(f["fish_id"] == fish.uuid for f in ev.get("involved_fish", []))
                            and ev["event_type"] in ("missing_fish", "lethargy"))
                    ]
                    if fish_events:
                        disrupted.append(fish)

                if disrupted:
                    involved = [{"fish_id": f.uuid, "fish_name": f.name} for f in disrupted]
                    payload  = await self._create_prediction(
                        db,
                        prediction_type = "feeding_disruption",
                        horizon_minutes = 60,
                        confidence      = round(min(0.80, 0.35 + len(disrupted) * 0.10), 2),
                        involved        = involved,
                        narrative       = _NARRATIVES["feeding_disruption"].format(
                            fish=", ".join(f.name for f in disrupted[:2]),
                            event_type=s.event_type.replace("_", " "),
                        ),
                        event_type = "feeding_disruption",
                    )
                    if payload:
                        predictions.append(payload)
                break  # only check the first matching feeding schedule per cycle

        # ── Rule 7: spawning_imminent ─────────────────────────────────
        # A fish showing territory_defense pattern AND pair_bonding pattern
        # is exhibiting classic pre-spawn behaviour in cichlids.
        try:
            from sqlalchemy import select as _sel
            from convict.models.behavior_pattern import BehaviorPattern

            territory_rows = (await db.execute(
                _sel(BehaviorPattern).where(
                    BehaviorPattern.pattern_type == "territory_defense",
                    BehaviorPattern.confidence   >  0.40,
                )
            )).scalars().all()

            bond_rows = (await db.execute(
                _sel(BehaviorPattern).where(
                    BehaviorPattern.pattern_type == "pair_bonding",
                    BehaviorPattern.confidence   >  0.30,
                )
            )).scalars().all()

            terr_fish_ids = {p.fish_id for p in territory_rows}
            bond_fish_ids = {p.fish_id for p in bond_rows}
            spawning_db_ids = terr_fish_ids & bond_fish_ids

            if spawning_db_ids:
                fish_by_db_id = {f.id: f for f in self._fish}
                for db_id in list(spawning_db_ids)[:1]:  # one per cycle
                    fish = fish_by_db_id.get(db_id)
                    if not fish:
                        continue
                    involved = self._fish_refs([fish.uuid])
                    payload  = await self._create_prediction(
                        db,
                        prediction_type = "spawning_imminent",
                        horizon_minutes = 1440,   # 24h
                        confidence      = 0.65,
                        involved        = involved,
                        narrative       = _NARRATIVES["spawning_imminent"].format(
                            fish=fish.name,
                        ),
                        event_type = "territory_defense",
                    )
                    if payload:
                        predictions.append(payload)
        except Exception:
            pass  # pattern queries are best-effort

        # ── Rule 8: circadian_disruption ─────────────────────────────
        # If multiple fish show circadian_deviation patterns within the last 2 hours,
        # the disruption is systemic (environmental) rather than individual (illness).
        try:
            from sqlalchemy import select as _sel2
            from convict.models.behavior_pattern import BehaviorPattern as _BP

            circ_rows = (await db.execute(
                _sel2(_BP).where(
                    _BP.pattern_type == "circadian_deviation",
                    _BP.last_seen_at >= datetime.utcnow() - timedelta(hours=2),
                )
            )).scalars().all()

            if len(circ_rows) >= max(2, len(self._fish) // 2):
                fish_by_db_id = {f.id: f.uuid for f in self._fish}
                uuids = [fish_by_db_id[p.fish_id] for p in circ_rows if p.fish_id in fish_by_db_id]
                involved = self._fish_refs(uuids[:4])
                payload  = await self._create_prediction(
                    db,
                    prediction_type = "circadian_disruption",
                    horizon_minutes = 120,
                    confidence      = round(min(0.80, 0.40 + len(circ_rows) * 0.10), 2),
                    involved        = involved,
                    narrative       = _NARRATIVES["circadian_disruption"].format(
                        count=len(circ_rows),
                    ),
                    event_type = "circadian_deviation",
                )
                if payload:
                    predictions.append(payload)
        except Exception:
            pass

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

        # Don't create duplicate active predictions of the same type
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
        await db.flush()

        bundle_uuid = str(uuid.uuid4())
        bundle = EvidenceBundle(
            uuid              = bundle_uuid,
            prediction_id     = pred.id,
            bundle_type       = "anomaly_chain",
            supporting_events = json.dumps([e["uuid"] for e in self._recent_events[-10:]]),
            narrative         = narrative,
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
        from sqlalchemy import update
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
