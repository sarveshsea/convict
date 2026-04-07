import uuid
from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    # "feeding" | "lights_on" | "lights_off" | "water_change"
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    time_of_day: Mapped[str] = mapped_column(String, nullable=False)  # "HH:MM" 24h
    days_of_week: Mapped[str | None] = mapped_column(String, nullable=True)  # JSON [0..6], null = daily
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tank: Mapped["Tank"] = relationship("Tank", back_populates="schedules")
