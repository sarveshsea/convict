import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    name: Mapped[str] = mapped_column(String, nullable=False)

    # Fractional coords [0, 1] relative to frame dimensions
    x_min: Mapped[float] = mapped_column(Float, default=0.0)
    y_min: Mapped[float] = mapped_column(Float, default=0.0)
    x_max: Mapped[float] = mapped_column(Float, default=1.0)
    y_max: Mapped[float] = mapped_column(Float, default=1.0)

    # "open" | "shelter" | "territory" | "feeding" | "surface" | "substrate"
    zone_type: Mapped[str] = mapped_column(String, default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tank: Mapped["Tank"] = relationship("Tank", back_populates="zones")
