import uuid
from datetime import datetime, date
from sqlalchemy import Integer, String, Float, Boolean, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class KnownFish(Base):
    __tablename__ = "known_fish"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    tank_id: Mapped[int] = mapped_column(Integer, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False)

    name: Mapped[str] = mapped_column(String, nullable=False)
    species: Mapped[str] = mapped_column(String, nullable=False)
    common_name: Mapped[str | None] = mapped_column(String, nullable=True)

    # "small" | "medium" | "large"
    size_class: Mapped[str] = mapped_column(String, default="medium")
    estimated_length_cm: Mapped[float | None] = mapped_column(Float, nullable=True)

    # "aggressive" | "semi-aggressive" | "peaceful"
    temperament: Mapped[str] = mapped_column(String, default="peaceful")
    appearance_notes: Mapped[str | None] = mapped_column(String, nullable=True)

    # Serialized numpy HSV histogram (updated after first observation)
    color_histogram: Mapped[bytes | None] = mapped_column(nullable=True)

    # JSON: list of zone UUIDs this fish prefers
    preferred_zones: Mapped[str | None] = mapped_column(String, nullable=True)

    date_added: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    species_guess_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    # JPEG crop captured at first auto-detection
    snapshot_jpeg: Mapped[bytes | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    tank: Mapped["Tank"] = relationship("Tank", back_populates="fish")
    baselines: Mapped[list["BehaviorBaseline"]] = relationship("BehaviorBaseline", back_populates="fish")
    patterns: Mapped[list["BehaviorPattern"]] = relationship("BehaviorPattern", back_populates="fish")
