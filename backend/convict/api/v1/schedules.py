import json
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from convict.api.deps import get_db
from convict.engines.knowledge import tank_knowledge_engine as ke
from convict.schemas.schedule import ScheduleCreate, ScheduleOut

router = APIRouter(prefix="/tank/schedules", tags=["schedules"])


def _enrich(s) -> ScheduleOut:
    data = ScheduleOut.model_validate(s)
    if s.days_of_week:
        try:
            data.days_of_week = json.loads(s.days_of_week)
        except Exception:
            data.days_of_week = None
    return data


@router.get("", response_model=list[ScheduleOut])
async def list_schedules(db: AsyncSession = Depends(get_db)):
    schedules = await ke.list_schedules(db)
    return [_enrich(s) for s in schedules]


@router.post("", response_model=ScheduleOut, status_code=201)
async def create_schedule(data: ScheduleCreate, db: AsyncSession = Depends(get_db)):
    schedule = await ke.create_schedule(db, data)
    return _enrich(schedule)


@router.delete("/{schedule_uuid}", status_code=204)
async def delete_schedule(schedule_uuid: str, db: AsyncSession = Depends(get_db)):
    await ke.delete_schedule(db, schedule_uuid)
