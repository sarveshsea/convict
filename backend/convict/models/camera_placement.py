import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class CameraPlacement(Base):
    __tablename__ = "camera_placements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False, default="Camera")
    camera_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # OpenCV device index
    wall: Mapped[str] = mapped_column(String, nullable=False, default="front")  # front|back|left|right|top
    pos_u: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)   # 0-1 horizontal on wall
    pos_v: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)   # 0-1 vertical on wall
    fov_degrees: Mapped[float] = mapped_column(Float, nullable=False, default=78.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tank: Mapped["Tank"] = relationship("Tank", back_populates="camera_placements")
