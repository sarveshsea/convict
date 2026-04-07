from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from convict.database import Base


class DetectionFrame(Base):
    __tablename__ = "detection_frames"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    frame_width: Mapped[int] = mapped_column(Integer, default=640)
    frame_height: Mapped[int] = mapped_column(Integer, default=480)
    entity_count: Mapped[int] = mapped_column(Integer, default=0)
    # JSON: list of {track_id, bbox, confidence, zone_ids, speed}
    raw_detections: Mapped[str | None] = mapped_column(String, nullable=True)
