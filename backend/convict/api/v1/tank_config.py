from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from convict.api.deps import get_db
from convict.models.tank import Tank
from convict.models.camera_placement import CameraPlacement
from convict.models.tank_obstacle import TankObstacle

router = APIRouter(prefix="/tank-config", tags=["tank-config"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TankDimensionsIn(BaseModel):
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None
    depth_cm: Optional[float] = None


class TankDimensionsOut(BaseModel):
    uuid: str
    name: str
    width_cm: Optional[float]
    height_cm: Optional[float]
    depth_cm: Optional[float]

    model_config = {"from_attributes": True}


class CameraIn(BaseModel):
    label: str = "Camera"
    camera_index: int = 0
    wall: str = "front"
    pos_u: float = 0.5
    pos_v: float = 0.5
    fov_degrees: float = 78.0


class CameraOut(BaseModel):
    uuid: str
    label: str
    camera_index: int
    wall: str
    pos_u: float
    pos_v: float
    fov_degrees: float

    model_config = {"from_attributes": True}


class ObstacleIn(BaseModel):
    label: str = "Obstacle"
    x_frac: float = 0.5
    y_frac: float = 0.25
    z_frac: float = 0.5
    w_frac: float = 0.2
    h_frac: float = 0.3
    d_frac: float = 0.15
    color: str = "#8B6914"
    passable: bool = False


class ObstacleOut(BaseModel):
    uuid: str
    label: str
    x_frac: float
    y_frac: float
    z_frac: float
    w_frac: float
    h_frac: float
    d_frac: float
    color: str
    passable: bool

    model_config = {"from_attributes": True}


class TankConfigOut(BaseModel):
    tank: TankDimensionsOut
    cameras: list[CameraOut]
    obstacles: list[ObstacleOut]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_tank(db: AsyncSession) -> Tank:
    result = await db.execute(select(Tank).limit(1))
    tank = result.scalars().first()
    if tank is None:
        raise HTTPException(status_code=404, detail="No tank configured")
    return tank


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=TankConfigOut)
async def get_tank_config(db: AsyncSession = Depends(get_db)):
    tank = await _get_tank(db)

    cameras_result = await db.execute(
        select(CameraPlacement).where(CameraPlacement.tank_id == tank.id)
    )
    cameras = cameras_result.scalars().all()

    obstacles_result = await db.execute(
        select(TankObstacle).where(TankObstacle.tank_id == tank.id)
    )
    obstacles = obstacles_result.scalars().all()

    return TankConfigOut(
        tank=TankDimensionsOut.model_validate(tank),
        cameras=[CameraOut.model_validate(c) for c in cameras],
        obstacles=[ObstacleOut.model_validate(o) for o in obstacles],
    )


@router.put("/dimensions", response_model=TankDimensionsOut)
async def update_dimensions(data: TankDimensionsIn, db: AsyncSession = Depends(get_db)):
    tank = await _get_tank(db)

    if data.width_cm is not None:
        tank.width_cm = data.width_cm
    if data.height_cm is not None:
        tank.height_cm = data.height_cm
    if data.depth_cm is not None:
        tank.depth_cm = data.depth_cm

    await db.commit()
    await db.refresh(tank)
    return TankDimensionsOut.model_validate(tank)


@router.post("/cameras", response_model=CameraOut, status_code=201)
async def create_camera(data: CameraIn, db: AsyncSession = Depends(get_db)):
    tank = await _get_tank(db)

    camera = CameraPlacement(
        tank_id=tank.id,
        label=data.label,
        camera_index=data.camera_index,
        wall=data.wall,
        pos_u=data.pos_u,
        pos_v=data.pos_v,
        fov_degrees=data.fov_degrees,
    )
    db.add(camera)
    await db.commit()
    await db.refresh(camera)
    return CameraOut.model_validate(camera)


@router.delete("/cameras/{uuid}", status_code=204)
async def delete_camera(uuid: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CameraPlacement).where(CameraPlacement.uuid == uuid)
    )
    camera = result.scalars().first()
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    await db.delete(camera)
    await db.commit()


@router.post("/obstacles", response_model=ObstacleOut, status_code=201)
async def create_obstacle(data: ObstacleIn, db: AsyncSession = Depends(get_db)):
    tank = await _get_tank(db)

    obstacle = TankObstacle(
        tank_id=tank.id,
        label=data.label,
        x_frac=data.x_frac,
        y_frac=data.y_frac,
        z_frac=data.z_frac,
        w_frac=data.w_frac,
        h_frac=data.h_frac,
        d_frac=data.d_frac,
        color=data.color,
        passable=data.passable,
    )
    db.add(obstacle)
    await db.commit()
    await db.refresh(obstacle)
    return ObstacleOut.model_validate(obstacle)


@router.put("/obstacles/{uuid}", response_model=ObstacleOut)
async def update_obstacle(uuid: str, data: ObstacleIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TankObstacle).where(TankObstacle.uuid == uuid)
    )
    obstacle = result.scalars().first()
    if obstacle is None:
        raise HTTPException(status_code=404, detail="Obstacle not found")

    obstacle.label = data.label
    obstacle.x_frac = data.x_frac
    obstacle.y_frac = data.y_frac
    obstacle.z_frac = data.z_frac
    obstacle.w_frac = data.w_frac
    obstacle.h_frac = data.h_frac
    obstacle.d_frac = data.d_frac
    obstacle.color = data.color
    obstacle.passable = data.passable

    await db.commit()
    await db.refresh(obstacle)
    return ObstacleOut.model_validate(obstacle)


@router.delete("/obstacles/{uuid}", status_code=204)
async def delete_obstacle(uuid: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TankObstacle).where(TankObstacle.uuid == uuid)
    )
    obstacle = result.scalars().first()
    if obstacle is None:
        raise HTTPException(status_code=404, detail="Obstacle not found")
    await db.delete(obstacle)
    await db.commit()
