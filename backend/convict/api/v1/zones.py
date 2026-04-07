from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from convict.api.deps import get_db
from convict.engines.knowledge import tank_knowledge_engine as ke
from convict.schemas.zone import ZoneCreate, ZoneUpdate, ZoneOut

router = APIRouter(prefix="/tank/zones", tags=["zones"])


@router.get("", response_model=list[ZoneOut])
async def list_zones(db: AsyncSession = Depends(get_db)):
    return await ke.list_zones(db)


@router.post("", response_model=ZoneOut, status_code=201)
async def create_zone(data: ZoneCreate, db: AsyncSession = Depends(get_db)):
    return await ke.create_zone(db, data)


@router.put("/{zone_uuid}", response_model=ZoneOut)
async def update_zone(zone_uuid: str, data: ZoneUpdate, db: AsyncSession = Depends(get_db)):
    return await ke.update_zone(db, zone_uuid, data)


@router.delete("/{zone_uuid}", status_code=204)
async def delete_zone(zone_uuid: str, db: AsyncSession = Depends(get_db)):
    await ke.delete_zone(db, zone_uuid)
