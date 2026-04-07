from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from convict.database import Base


class IdentityHypothesis(Base):
    __tablename__ = "identity_hypotheses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    track_id: Mapped[int] = mapped_column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    fish_id: Mapped[int] = mapped_column(Integer, ForeignKey("known_fish.id", ondelete="CASCADE"), nullable=False)

    confidence: Mapped[float] = mapped_column(Float, default=0.0)  # EMA-smoothed [0,1]
    size_score: Mapped[float] = mapped_column(Float, default=0.0)
    zone_score: Mapped[float] = mapped_column(Float, default=0.0)
    color_score: Mapped[float] = mapped_column(Float, default=0.0)
    path_score: Mapped[float] = mapped_column(Float, default=0.0)

    # JSON list: ["size_match", "zone_prior", "color_close"]
    reason_codes: Mapped[str | None] = mapped_column(String, nullable=True)
    is_operator_confirmed: Mapped[bool] = mapped_column(default=False)
    is_operator_rejected: Mapped[bool] = mapped_column(default=False)

    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    track: Mapped["Track"] = relationship("Track", back_populates="hypotheses")
    fish: Mapped["KnownFish"] = relationship("KnownFish")
