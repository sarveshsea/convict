from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)  # ByteTrack stable ID
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, default=0)

    # Serialized numpy float32 array of [t, x, y] (downsampled)
    centroid_path: Mapped[bytes | None] = mapped_column(nullable=True)
    # JSON list of {t, x1, y1, x2, y2}
    bbox_sequence: Mapped[str | None] = mapped_column(String, nullable=True)

    # Best identity assignment
    identity_fish_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("known_fish.id", ondelete="SET NULL"), nullable=True)
    identity_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    hypotheses: Mapped[list["IdentityHypothesis"]] = relationship("IdentityHypothesis", back_populates="track", cascade="all, delete-orphan")
