import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class Tank(Base):
    __tablename__ = "tanks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    volume_gallons: Mapped[int] = mapped_column(Integer, nullable=False)
    width_px: Mapped[int] = mapped_column(Integer, default=640)
    height_px: Mapped[int] = mapped_column(Integer, default=480)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    width_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    depth_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    fish: Mapped[list["KnownFish"]] = relationship("KnownFish", back_populates="tank", cascade="all, delete-orphan")
    zones: Mapped[list["Zone"]] = relationship("Zone", back_populates="tank", cascade="all, delete-orphan")
    schedules: Mapped[list["Schedule"]] = relationship("Schedule", back_populates="tank", cascade="all, delete-orphan")
    camera_placements: Mapped[list["CameraPlacement"]] = relationship("CameraPlacement", back_populates="tank", cascade="all, delete-orphan")
    obstacles: Mapped[list["TankObstacle"]] = relationship("TankObstacle", back_populates="tank", cascade="all, delete-orphan")
