from datetime import datetime, date
from typing import Literal
from pydantic import BaseModel, Field


SizeClass = Literal["small", "medium", "large"]
Temperament = Literal["aggressive", "semi-aggressive", "peaceful"]


class KnownFishCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    species: str = Field(..., min_length=1, max_length=120)
    common_name: str | None = None
    size_class: SizeClass = "medium"
    estimated_length_cm: float | None = Field(None, gt=0)
    temperament: Temperament = "peaceful"
    appearance_notes: str | None = None
    preferred_zones: list[str] | None = None  # list of zone UUIDs
    date_added: date | None = None


class KnownFishUpdate(BaseModel):
    name: str | None = None
    species: str | None = None
    common_name: str | None = None
    size_class: SizeClass | None = None
    estimated_length_cm: float | None = None
    temperament: Temperament | None = None
    appearance_notes: str | None = None
    preferred_zones: list[str] | None = None
    date_added: date | None = None
    is_active: bool | None = None


class KnownFishOut(BaseModel):
    uuid: str
    tank_uuid: str | None = None
    name: str
    species: str
    common_name: str | None
    size_class: str
    estimated_length_cm: float | None
    temperament: str
    appearance_notes: str | None
    preferred_zones: list[str] | None
    date_added: date | None
    is_active: bool
    auto_detected: bool = False
    species_guess_confidence: float = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
