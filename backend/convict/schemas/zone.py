from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

ZoneType = Literal["open", "shelter", "territory", "feeding", "surface", "substrate"]


class ZoneCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    x_min: float = Field(..., ge=0.0, le=1.0)
    y_min: float = Field(..., ge=0.0, le=1.0)
    x_max: float = Field(..., ge=0.0, le=1.0)
    y_max: float = Field(..., ge=0.0, le=1.0)
    zone_type: ZoneType = "open"


class ZoneUpdate(BaseModel):
    name: str | None = None
    x_min: float | None = Field(None, ge=0.0, le=1.0)
    y_min: float | None = Field(None, ge=0.0, le=1.0)
    x_max: float | None = Field(None, ge=0.0, le=1.0)
    y_max: float | None = Field(None, ge=0.0, le=1.0)
    zone_type: ZoneType | None = None


class ZoneOut(BaseModel):
    uuid: str
    tank_uuid: str | None = None
    name: str
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    zone_type: str
    created_at: datetime

    model_config = {"from_attributes": True}
