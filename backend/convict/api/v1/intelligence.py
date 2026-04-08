"""
Intelligence API — community health and relationship graph.

GET /api/v1/intelligence/community-health
  Returns the last N community health snapshots with trend direction.

GET /api/v1/intelligence/relationships
  Returns a graph: nodes (fish) + edges (aggregated interaction_edges).
  Edge weight = total interaction count between the pair.
  Edge type   = dominant interaction type (harassment > proximity > schooling).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from convict.api.deps import get_db
from convict.engines.knowledge.tank_knowledge_engine import require_tank
from convict.models.community_health_snapshot import CommunityHealthSnapshot
from convict.models.interaction_edge import InteractionEdge
from convict.models.known_fish import KnownFish

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

_TYPE_PRIORITY = {"harassment": 3, "proximity": 2, "schooling": 1, "avoidance": 0}


@router.get("/community-health")
async def get_community_health(
    limit: int = Query(48, le=200),   # default: last 4h at 5min cadence
    db: AsyncSession = Depends(get_db),
):
    """
    Returns:
      current   — latest snapshot (score + components)
      trend     — "improving" | "declining" | "stable" | "unknown"
      history   — list of {computed_at, score} for sparkline rendering
    """
    tank = await require_tank(db)
    rows = (await db.execute(
        select(CommunityHealthSnapshot)
        .where(CommunityHealthSnapshot.tank_id == tank.id)
        .order_by(desc(CommunityHealthSnapshot.computed_at))
        .limit(limit)
    )).scalars().all()

    if not rows:
        return {"current": None, "trend": "unknown", "history": []}

    latest = rows[0]
    current = {
        "score":      latest.score,
        "components": json.loads(latest.components),
        "computed_at": latest.computed_at.isoformat(),
    }

    history = [
        {"computed_at": r.computed_at.isoformat(), "score": r.score}
        for r in reversed(rows)
    ]

    # Trend: compare mean of last 3 vs mean of prior 3 snapshots
    trend = "unknown"
    if len(rows) >= 6:
        recent = sum(r.score for r in rows[:3]) / 3
        prior  = sum(r.score for r in rows[3:6]) / 3
        diff   = recent - prior
        if diff > 0.03:
            trend = "improving"
        elif diff < -0.03:
            trend = "declining"
        else:
            trend = "stable"

    return {"current": current, "trend": trend, "history": history}


@router.get("/relationships")
async def get_relationships(
    hours: int = Query(24, le=168),   # look-back window
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a graph suitable for force-directed or matrix rendering:

    nodes: [{id, name, species, temperament}]
    edges: [{fish_a_id, fish_b_id, weight, dominant_type, harassment_count, proximity_count}]
    """
    tank = await require_tank(db)
    since = datetime.utcnow() - timedelta(hours=hours)

    # ── Fetch edges ────────────────────────────────────────────────────
    edge_rows = (await db.execute(
        select(InteractionEdge)
        .where(
            InteractionEdge.tank_id     == tank.id,
            InteractionEdge.occurred_at >= since,
        )
    )).scalars().all()

    if not edge_rows:
        # Return nodes only (so frontend can still render fish list)
        fish_rows = (await db.execute(
            select(KnownFish).where(KnownFish.is_active == True)
        )).scalars().all()
        return {
            "nodes": [_fish_node(f) for f in fish_rows],
            "edges": [],
        }

    # ── Aggregate edges by fish pair ───────────────────────────────────
    # Collect all fish ids involved
    fish_db_ids: set[int] = set()
    for e in edge_rows:
        fish_db_ids.add(e.fish_a_id)
        fish_db_ids.add(e.fish_b_id)

    fish_rows = (await db.execute(
        select(KnownFish).where(KnownFish.id.in_(fish_db_ids))
    )).scalars().all()
    fish_by_id = {f.id: f for f in fish_rows}

    # Also fetch all active fish for complete node list
    all_fish = (await db.execute(
        select(KnownFish).where(KnownFish.is_active == True)
    )).scalars().all()

    # Aggregate: (fish_a_uuid, fish_b_uuid) → counts by type
    pair_counts: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in edge_rows:
        fa = fish_by_id.get(e.fish_a_id)
        fb = fish_by_id.get(e.fish_b_id)
        if not fa or not fb:
            continue
        # Canonical order by uuid string for consistent keys
        key = (fa.uuid, fb.uuid) if fa.uuid < fb.uuid else (fb.uuid, fa.uuid)
        pair_counts[key][e.interaction_type] += 1

    edges = []
    for (uuid_a, uuid_b), counts in pair_counts.items():
        total = sum(counts.values())
        dominant = max(counts, key=lambda t: (_TYPE_PRIORITY.get(t, 0), counts[t]))
        edges.append({
            "fish_a_id":        uuid_a,
            "fish_b_id":        uuid_b,
            "weight":           total,
            "dominant_type":    dominant,
            "harassment_count": counts.get("harassment", 0),
            "proximity_count":  counts.get("proximity", 0),
            "schooling_count":  counts.get("schooling", 0),
        })

    # Sort edges: most interactions first
    edges.sort(key=lambda e: -e["weight"])

    return {
        "nodes": [_fish_node(f) for f in all_fish],
        "edges": edges,
        "window_hours": hours,
    }


def _fish_node(f: KnownFish) -> dict:
    return {
        "id":          f.uuid,
        "name":        f.name,
        "species":     f.species or "",
        "temperament": f.temperament or "peaceful",
        "size_class":  f.size_class or "medium",
    }
