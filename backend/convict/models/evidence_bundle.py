import uuid
from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class EvidenceBundle(Base):
    __tablename__ = "evidence_bundles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)

    prediction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("predictions.id", ondelete="CASCADE"), nullable=True)
    event_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("behavior_events.id", ondelete="SET NULL"), nullable=True)

    # "anomaly_chain" | "pattern_sequence" | "missing_fish" | "baseline_deviation"
    bundle_type: Mapped[str] = mapped_column(String, nullable=False)

    # JSON: list of event UUIDs in chronological order
    supporting_events: Mapped[str | None] = mapped_column(String, nullable=True)
    # JSON: list of track IDs that support this bundle
    supporting_tracks: Mapped[str | None] = mapped_column(String, nullable=True)

    # Template-generated human-readable explanation
    narrative: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    prediction: Mapped["Prediction | None"] = relationship("Prediction", back_populates="evidence_bundles")
