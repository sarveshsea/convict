import json
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from convict.api.deps import get_db
from convict.engines.knowledge import tank_knowledge_engine as ke
from convict.schemas.known_fish import KnownFishCreate, KnownFishUpdate, KnownFishOut

router = APIRouter(prefix="/tank/fish", tags=["fish"])


def _enrich(fish, tank=None) -> KnownFishOut:
    data = KnownFishOut.model_validate(fish)
    if fish.preferred_zones:
        try:
            data.preferred_zones = json.loads(fish.preferred_zones)
        except Exception:
            data.preferred_zones = []
    return data


@router.get("", response_model=list[KnownFishOut])
async def list_fish(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    fish_list = await ke.list_fish(db, include_inactive)
    return [_enrich(f) for f in fish_list]


@router.post("", response_model=KnownFishOut, status_code=201)
async def create_fish(data: KnownFishCreate, db: AsyncSession = Depends(get_db)):
    fish = await ke.create_fish(db, data)
    return _enrich(fish)


@router.get("/{fish_uuid}", response_model=KnownFishOut)
async def get_fish(fish_uuid: str, db: AsyncSession = Depends(get_db)):
    fish = await ke.get_fish_by_uuid(db, fish_uuid)
    return _enrich(fish)


@router.put("/{fish_uuid}", response_model=KnownFishOut)
async def update_fish(fish_uuid: str, data: KnownFishUpdate, db: AsyncSession = Depends(get_db)):
    fish = await ke.update_fish(db, fish_uuid, data)
    return _enrich(fish)


@router.delete("/{fish_uuid}", status_code=204)
async def delete_fish(fish_uuid: str, db: AsyncSession = Depends(get_db)):
    await ke.delete_fish(db, fish_uuid)


@router.get("/{fish_uuid}/snapshot")
async def fish_snapshot(fish_uuid: str):
    if not re.match(r"^[0-9a-f-]+$", fish_uuid):
        raise HTTPException(status_code=400, detail="Invalid uuid")
    from convict.config import settings
    path = settings.db_path.parent / "snapshots" / f"{fish_uuid}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No snapshot available")
    return FileResponse(str(path), media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Drilldown endpoints
# ---------------------------------------------------------------------------

@router.get("/{fish_uuid}/summary")
async def fish_summary(fish_uuid: str, db: AsyncSession = Depends(get_db)):
    from convict.models.known_fish import KnownFish
    from convict.models.behavior_baseline import BehaviorBaseline
    from convict.models.behavior_event import BehaviorEvent

    fish = await ke.get_fish_by_uuid(db, fish_uuid)

    # Latest baseline
    bl_row = (await db.execute(
        select(BehaviorBaseline)
        .where(BehaviorBaseline.fish_id == fish.id)
        .order_by(desc(BehaviorBaseline.computed_at))
        .limit(1)
    )).scalar_one_or_none()

    # Recent events involving this fish
    events_rows = (await db.execute(
        select(BehaviorEvent)
        .where(BehaviorEvent.involved_fish.contains(fish_uuid))
        .order_by(desc(BehaviorEvent.occurred_at))
        .limit(10)
    )).scalars().all()

    baseline = None
    if bl_row:
        baseline = {
            "computed_at":            bl_row.computed_at.isoformat(),
            "zone_time_fractions":    json.loads(bl_row.zone_time_fractions or "{}"),
            "mean_speed_px_per_frame": bl_row.mean_speed_px_per_frame,
            "speed_stddev":            bl_row.speed_stddev,
            "activity_by_hour":        json.loads(bl_row.activity_by_hour or "{}"),
            "observation_frame_count": bl_row.observation_frame_count,
        }

    return {
        "fish":     _enrich(fish).model_dump(),
        "baseline": baseline,
        "recent_events": [
            {
                "uuid":          e.uuid,
                "event_type":    e.event_type,
                "severity":      e.severity,
                "occurred_at":   e.occurred_at.isoformat(),
                "involved_fish": json.loads(e.involved_fish or "[]"),
            }
            for e in events_rows
        ],
    }


@router.get("/{fish_uuid}/zone-heatmap")
async def fish_zone_heatmap(fish_uuid: str, db: AsyncSession = Depends(get_db)):
    from convict.models.known_fish import KnownFish
    from convict.models.behavior_baseline import BehaviorBaseline

    fish   = await ke.get_fish_by_uuid(db, fish_uuid)
    bl_row = (await db.execute(
        select(BehaviorBaseline)
        .where(BehaviorBaseline.fish_id == fish.id)
        .order_by(desc(BehaviorBaseline.computed_at))
        .limit(1)
    )).scalar_one_or_none()

    fracs = json.loads(bl_row.zone_time_fractions or "{}") if bl_row else {}
    return {"fish_uuid": fish_uuid, "zone_time_fractions": fracs}


@router.get("/{fish_uuid}/interaction-history")
async def fish_interaction_history(
    fish_uuid: str,
    limit: int = Query(30, le=100),
    db: AsyncSession = Depends(get_db),
):
    from convict.models.behavior_event import BehaviorEvent

    await ke.get_fish_by_uuid(db, fish_uuid)  # 404 if missing
    rows = (await db.execute(
        select(BehaviorEvent)
        .where(BehaviorEvent.involved_fish.contains(fish_uuid))
        .order_by(desc(BehaviorEvent.occurred_at))
        .limit(limit)
    )).scalars().all()

    return [
        {
            "uuid":          r.uuid,
            "event_type":    r.event_type,
            "severity":      r.severity,
            "occurred_at":   r.occurred_at.isoformat(),
            "involved_fish": json.loads(r.involved_fish or "[]"),
            "duration_seconds": r.duration_seconds,
        }
        for r in rows
    ]


@router.get("/{fish_uuid}/confidence-history")
async def fish_confidence_history(
    fish_uuid: str,
    limit: int = Query(60, le=300),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the last N baseline snapshots as a confidence proxy.
    (Full per-frame confidence stored only in-memory; DB stores periodic snapshots.)
    """
    from convict.models.behavior_baseline import BehaviorBaseline

    fish   = await ke.get_fish_by_uuid(db, fish_uuid)
    rows   = (await db.execute(
        select(BehaviorBaseline)
        .where(BehaviorBaseline.fish_id == fish.id)
        .order_by(BehaviorBaseline.computed_at)
        .limit(limit)
    )).scalars().all()

    return [
        {
            "t":      r.computed_at.isoformat(),
            "frames": r.observation_frame_count,
            "mean_speed": r.mean_speed_px_per_frame,
        }
        for r in rows
    ]
