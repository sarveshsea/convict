from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class BehaviorBaseline(Base):
    __tablename__ = "behavior_baselines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fish_id: Mapped[int] = mapped_column(Integer, ForeignKey("known_fish.id", ondelete="CASCADE"), nullable=False, index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    window_hours: Mapped[int] = mapped_column(Integer, default=24)

    # JSON: {zone_uuid: fraction}
    zone_time_fractions: Mapped[str | None] = mapped_column(String, nullable=True)
    mean_speed_px_per_frame: Mapped[float] = mapped_column(Float, default=0.0)
    speed_stddev: Mapped[float] = mapped_column(Float, default=0.0)

    # JSON: 24-element array, mean speed per hour of day
    activity_by_hour: Mapped[str | None] = mapped_column(String, nullable=True)

    # JSON: {fish_uuid: count}
    interaction_counts: Mapped[str | None] = mapped_column(String, nullable=True)

    observation_frame_count: Mapped[int] = mapped_column(Integer, default=0)

    fish: Mapped["KnownFish"] = relationship("KnownFish", back_populates="baselines")
