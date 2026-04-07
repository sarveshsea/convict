"""
Tank Knowledge Engine — CRUD for Tank, KnownFish, Zone, Schedule.
This is the user-seeded prior knowledge graph that seeds all intelligence engines.
"""
import json
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from convict.models.tank import Tank
from convict.models.known_fish import KnownFish
from convict.models.zone import Zone
from convict.models.schedule import Schedule
from convict.schemas.tank import TankCreate, TankUpdate
from convict.schemas.known_fish import KnownFishCreate, KnownFishUpdate
from convict.schemas.zone import ZoneCreate, ZoneUpdate
from convict.schemas.schedule import ScheduleCreate


# ---------------------------------------------------------------------------
# Tank
# ---------------------------------------------------------------------------

async def get_tank(db: AsyncSession) -> Tank | None:
    result = await db.execute(select(Tank).order_by(Tank.id).limit(1))
    return result.scalar_one_or_none()


async def require_tank(db: AsyncSession) -> Tank:
    tank = await get_tank(db)
    if not tank:
        raise HTTPException(status_code=404, detail="No tank configured. Run setup first.")
    return tank


async def create_tank(db: AsyncSession, data: TankCreate) -> Tank:
    existing = await get_tank(db)
    if existing:
        raise HTTPException(status_code=409, detail="Tank already exists. Use PATCH to update.")
    tank = Tank(**data.model_dump())
    db.add(tank)
    await db.commit()
    await db.refresh(tank)
    return tank


async def update_tank(db: AsyncSession, data: TankUpdate) -> Tank:
    tank = await require_tank(db)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(tank, field, value)
    await db.commit()
    await db.refresh(tank)
    return tank


# ---------------------------------------------------------------------------
# Known Fish
# ---------------------------------------------------------------------------

async def list_fish(db: AsyncSession, include_inactive: bool = False) -> list[KnownFish]:
    tank = await require_tank(db)
    q = select(KnownFish).where(KnownFish.tank_id == tank.id)
    if not include_inactive:
        q = q.where(KnownFish.is_active == True)
    q = q.order_by(KnownFish.name)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_fish_by_uuid(db: AsyncSession, fish_uuid: str) -> KnownFish:
    result = await db.execute(select(KnownFish).where(KnownFish.uuid == fish_uuid))
    fish = result.scalar_one_or_none()
    if not fish:
        raise HTTPException(status_code=404, detail=f"Fish {fish_uuid} not found")
    return fish


async def create_fish(db: AsyncSession, data: KnownFishCreate) -> KnownFish:
    tank = await require_tank(db)
    payload = data.model_dump(exclude={"preferred_zones"})
    if data.preferred_zones is not None:
        payload["preferred_zones"] = json.dumps(data.preferred_zones)
    fish = KnownFish(tank_id=tank.id, **payload)
    db.add(fish)
    await db.commit()
    await db.refresh(fish)
    return fish


async def update_fish(db: AsyncSession, fish_uuid: str, data: KnownFishUpdate) -> KnownFish:
    fish = await get_fish_by_uuid(db, fish_uuid)
    payload = data.model_dump(exclude_none=True, exclude={"preferred_zones"})
    for field, value in payload.items():
        setattr(fish, field, value)
    if data.preferred_zones is not None:
        fish.preferred_zones = json.dumps(data.preferred_zones)
    await db.commit()
    await db.refresh(fish)
    return fish


async def delete_fish(db: AsyncSession, fish_uuid: str) -> None:
    fish = await get_fish_by_uuid(db, fish_uuid)
    fish.is_active = False
    await db.commit()


# ---------------------------------------------------------------------------
# Zones
# ---------------------------------------------------------------------------

async def list_zones(db: AsyncSession) -> list[Zone]:
    tank = await require_tank(db)
    result = await db.execute(
        select(Zone).where(Zone.tank_id == tank.id).order_by(Zone.name)
    )
    return list(result.scalars().all())


async def get_zone_by_uuid(db: AsyncSession, zone_uuid: str) -> Zone:
    result = await db.execute(select(Zone).where(Zone.uuid == zone_uuid))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail=f"Zone {zone_uuid} not found")
    return zone


async def create_zone(db: AsyncSession, data: ZoneCreate) -> Zone:
    tank = await require_tank(db)
    zone = Zone(tank_id=tank.id, **data.model_dump())
    db.add(zone)
    await db.commit()
    await db.refresh(zone)
    return zone


async def update_zone(db: AsyncSession, zone_uuid: str, data: ZoneUpdate) -> Zone:
    zone = await get_zone_by_uuid(db, zone_uuid)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(zone, field, value)
    await db.commit()
    await db.refresh(zone)
    return zone


async def delete_zone(db: AsyncSession, zone_uuid: str) -> None:
    zone = await get_zone_by_uuid(db, zone_uuid)
    await db.delete(zone)
    await db.commit()


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------

async def list_schedules(db: AsyncSession) -> list[Schedule]:
    tank = await require_tank(db)
    result = await db.execute(
        select(Schedule).where(Schedule.tank_id == tank.id).order_by(Schedule.time_of_day)
    )
    return list(result.scalars().all())


async def get_schedule_by_uuid(db: AsyncSession, schedule_uuid: str) -> Schedule:
    result = await db.execute(select(Schedule).where(Schedule.uuid == schedule_uuid))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_uuid} not found")
    return schedule


async def create_schedule(db: AsyncSession, data: ScheduleCreate) -> Schedule:
    tank = await require_tank(db)
    payload = data.model_dump(exclude={"days_of_week"})
    if data.days_of_week is not None:
        payload["days_of_week"] = json.dumps(data.days_of_week)
    schedule = Schedule(tank_id=tank.id, **payload)
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


async def delete_schedule(db: AsyncSession, schedule_uuid: str) -> None:
    schedule = await get_schedule_by_uuid(db, schedule_uuid)
    await db.delete(schedule)
    await db.commit()
