import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class BehaviorPattern(Base):
    __tablename__ = "behavior_patterns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)

    # Nullable = tank-level pattern
    fish_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("known_fish.id", ondelete="CASCADE"), nullable=True)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    # "zone_preference" | "post_feeding_patrol" | "schooling" | "territory_defense" | "diel_activity"
    pattern_type: Mapped[str] = mapped_column(String, nullable=False)

    # JSON: pattern descriptor specific to pattern_type
    signature: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)

    fish: Mapped["KnownFish | None"] = relationship("KnownFish", back_populates="patterns")
