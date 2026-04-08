import uuid
from datetime import datetime
from sqlalchemy import Index, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from convict.database import Base


class InteractionEdge(Base):
    """
    Persistent record of a fish-to-fish interaction event.

    interaction_type:
      "proximity"  — two identified fish were within proximity threshold for >1s
      "harassment" — sustained close contact triggering harassment threshold
      "schooling"  — correlated movement detected between the pair
      "avoidance"  — one fish consistently moves away from the other
    """
    __tablename__ = "interaction_edges"

    __table_args__ = (
        # Composite index for querying all interactions between a specific pair
        # of fish filtered by interaction type and ordered by time.
        Index(
            "ix_interaction_edges_pair_type_time",
            "fish_a_id",
            "fish_b_id",
            "interaction_type",
            "occurred_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String, unique=True, nullable=False,
        default=lambda: str(uuid.uuid4()),
    )
    tank_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tanks.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # Both fish in the interaction — fish_a_id <= fish_b_id by DB id for
    # consistent deduplication (enforced at write time in the scorer)
    fish_a_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("known_fish.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    fish_b_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("known_fish.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    # Which fish initiated the interaction (faster / approaching fish).
    # NULL = could not be determined.
    initiator_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("known_fish.id", ondelete="SET NULL"), nullable=True,
    )

    interaction_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    zone_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True,
    )

    # True once both fish have been seen in their normal zones after the event
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
