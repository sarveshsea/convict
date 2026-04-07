import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class TankObstacle(Base):
    __tablename__ = "tank_obstacles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False, default="Obstacle")
    x_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)  # center, 0-1
    y_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.25)
    z_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    w_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.2)  # size, 0-1 of tank dim
    h_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    d_frac: Mapped[float] = mapped_column(Float, nullable=False, default=0.15)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#8B6914")
    passable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tank: Mapped["Tank"] = relationship("Tank", back_populates="obstacles")
