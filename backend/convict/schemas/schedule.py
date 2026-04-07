from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator
import re

EventType = Literal["feeding", "lights_on", "lights_off", "water_change"]


class ScheduleCreate(BaseModel):
    event_type: EventType
    time_of_day: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    days_of_week: list[int] | None = Field(None, description="0=Mon..6=Sun, null=daily")
    notes: str | None = None

    @field_validator("days_of_week")
    @classmethod
    def valid_days(cls, v: list[int] | None) -> list[int] | None:
        if v is not None:
            for d in v:
                if d < 0 or d > 6:
                    raise ValueError("days_of_week values must be 0-6")
        return v


class ScheduleOut(BaseModel):
    uuid: str
    tank_uuid: str | None = None
    event_type: str
    time_of_day: str
    days_of_week: list[int] | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
