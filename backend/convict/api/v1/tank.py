from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from convict.api.deps import get_db
from convict.engines.knowledge import tank_knowledge_engine as ke
from convict.schemas.tank import TankCreate, TankUpdate, TankOut

router = APIRouter(prefix="/tank", tags=["tank"])


@router.get("", response_model=TankOut)
async def get_tank(db: AsyncSession = Depends(get_db)):
    return await ke.require_tank(db)


@router.post("", response_model=TankOut, status_code=201)
async def create_tank(data: TankCreate, db: AsyncSession = Depends(get_db)):
    return await ke.create_tank(db, data)


@router.patch("", response_model=TankOut)
async def update_tank(data: TankUpdate, db: AsyncSession = Depends(get_db)):
    return await ke.update_tank(db, data)
