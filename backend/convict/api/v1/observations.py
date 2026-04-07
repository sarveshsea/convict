"""
Observations API — events, patterns, predictions, and prediction resolution.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, update, desc
from sqlalchemy.ext.asyncio import AsyncSession

from convict.api.deps import get_db
from convict.engines.knowledge.tank_knowledge_engine import require_tank
from convict.models.behavior_event import BehaviorEvent
from convict.models.behavior_pattern import BehaviorPattern
from convict.models.prediction import Prediction
from convict.models.evidence_bundle import EvidenceBundle
from convict.models.known_fish import KnownFish

router = APIRouter(prefix="/observations", tags=["observations"])


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.get("/events")
async def list_events(
    limit: int = Query(50, le=200),
    event_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    tank  = await require_tank(db)
    query = (
        select(BehaviorEvent)
        .where(BehaviorEvent.tank_id == tank.id)
        .order_by(desc(BehaviorEvent.occurred_at))
        .limit(limit)
    )
    if event_type:
        query = query.where(BehaviorEvent.event_type == event_type)

    rows = (await db.execute(query)).scalars().all()
    return [_event_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

@router.get("/patterns")
async def list_patterns(
    db: AsyncSession = Depends(get_db),
):
    tank  = await require_tank(db)
    rows  = (await db.execute(
        select(BehaviorPattern)
        .where(BehaviorPattern.tank_id == tank.id)
        .order_by(desc(BehaviorPattern.last_seen_at))
    )).scalars().all()

    results = []
    for r in rows:
        fish = None
        if r.fish_id:
            fish = (await db.execute(
                select(KnownFish).where(KnownFish.id == r.fish_id)
            )).scalar_one_or_none()
        results.append({
            "uuid":            r.uuid,
            "pattern_type":    r.pattern_type,
            "fish_id":         fish.uuid if fish else None,
            "fish_name":       fish.name if fish else None,
            "confidence":      r.confidence,
            "signature":       json.loads(r.signature) if r.signature else {},
            "first_seen_at":   r.first_seen_at.isoformat(),
            "last_seen_at":    r.last_seen_at.isoformat(),
            "occurrence_count": r.occurrence_count,
        })
    return results


# ---------------------------------------------------------------------------
# Predictions
# ---------------------------------------------------------------------------

@router.get("/predictions")
async def list_predictions(
    status: str = Query("active"),
    db: AsyncSession = Depends(get_db),
):
    tank  = await require_tank(db)
    query = (
        select(Prediction)
        .where(Prediction.tank_id == tank.id, Prediction.status == status)
        .order_by(desc(Prediction.created_at))
    )
    rows  = (await db.execute(query)).scalars().all()
    return [await _prediction_dict(r, db) for r in rows]


@router.post("/predictions/{pred_uuid}/resolve")
async def resolve_prediction(
    pred_uuid: str,
    outcome: Literal["resolved_correct", "resolved_incorrect"] = Query(...),
    notes: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(Prediction).where(Prediction.uuid == pred_uuid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Prediction not found")

    row.status           = outcome
    row.resolved_at      = datetime.utcnow()
    row.resolution_notes = notes
    await db.commit()
    return {"status": "ok", "outcome": outcome}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _event_dict(r: BehaviorEvent) -> dict:
    return {
        "uuid":          r.uuid,
        "event_type":    r.event_type,
        "severity":      r.severity,
        "occurred_at":   r.occurred_at.isoformat(),
        "involved_fish": json.loads(r.involved_fish) if r.involved_fish else [],
        "zone_id":       r.zone_id,
        "duration_seconds": r.duration_seconds,
        "notes":         r.notes,
    }


async def _prediction_dict(r: Prediction, db: AsyncSession) -> dict:
    bundle = (await db.execute(
        select(EvidenceBundle).where(EvidenceBundle.prediction_id == r.id)
    )).scalar_one_or_none()

    return {
        "uuid":               r.uuid,
        "prediction_type":    r.prediction_type,
        "confidence":         r.confidence,
        "horizon_minutes":    r.horizon_minutes,
        "involved_fish":      json.loads(r.involved_fish) if r.involved_fish else [],
        "narrative":          bundle.narrative if bundle else "",
        "evidence_bundle_id": bundle.uuid if bundle else None,
        "expires_at":         r.expires_at.isoformat(),
        "status":             r.status,
    }
