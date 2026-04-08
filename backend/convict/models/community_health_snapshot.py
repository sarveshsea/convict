from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from convict.database import Base


class CommunityHealthSnapshot(Base):
    """
    Point-in-time community health score for the tank.

    score    — 0.0 (critical) → 1.0 (excellent)
    components — JSON:
      {
        "aggression_rate": 0.0–1.0,   # 1 = no aggression
        "social_cohesion": 0.0–1.0,   # 1 = strong schooling / positive proximity
        "zone_stability":  0.0–1.0,   # 1 = all fish in preferred zones
        "isolation_index": 0.0–1.0,   # 1 = no isolation / hiding events
      }
    """
    __tablename__ = "community_health_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tank_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tanks.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    computed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True,
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    components: Mapped[str] = mapped_column(String, nullable=False)  # JSON
