import uuid
from datetime import datetime
from sqlalchemy import Index, Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from convict.database import Base


class BehaviorEvent(Base):
    __tablename__ = "behavior_events"

    __table_args__ = (
        # Composite index for the prediction engine, which queries behavior
        # events scoped to a tank ordered by recency every 5 minutes.
        # Note: involved_fish is a JSON string and cannot be indexed as a FK;
        # tank_id is the narrowest indexed scope available for per-fish lookups.
        Index(
            "ix_behavior_events_tank_occurred_at",
            "tank_id",
            "occurred_at",
            postgresql_ops={"occurred_at": "DESC"},
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    # "chase" | "dispersion" | "hiding" | "harassment" | "schooling" | "missing_fish" | "lethargy"
    event_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # "low" | "medium" | "high"
    severity: Mapped[str] = mapped_column(String, default="low")

    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    # JSON: list of fish UUIDs
    involved_fish: Mapped[str | None] = mapped_column(String, nullable=True)
    zone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)

    # JSON snapshot of observation data that triggered this event
    raw_evidence: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
