from datetime import datetime
from pydantic import BaseModel, Field


class TankCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    volume_gallons: int = Field(..., gt=0)
    width_px: int = Field(640, gt=0)
    height_px: int = Field(480, gt=0)
    notes: str | None = None


class TankUpdate(BaseModel):
    name: str | None = None
    volume_gallons: int | None = None
    width_px: int | None = None
    height_px: int | None = None
    notes: str | None = None


class TankOut(BaseModel):
    uuid: str
    name: str
    volume_gallons: int
    width_px: int
    height_px: int
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
