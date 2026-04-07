import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    # "aggression_escalation" | "isolation_trend" | "territory_shift" | "schooling_break" | "feeding_disruption"
    prediction_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    horizon_minutes: Mapped[int] = mapped_column(Integer, default=30)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # "active" | "resolved_correct" | "resolved_incorrect" | "expired"
    status: Mapped[str] = mapped_column(String, default="active", index=True)

    # JSON: list of fish UUIDs
    involved_fish: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(String, nullable=True)

    evidence_bundles: Mapped[list["EvidenceBundle"]] = relationship("EvidenceBundle", back_populates="prediction", cascade="all, delete-orphan")
