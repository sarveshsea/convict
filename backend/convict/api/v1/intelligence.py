"""
Intelligence API — community health, relationship graph, and incident grouping.

GET /api/v1/intelligence/community-health
GET /api/v1/intelligence/relationships
GET /api/v1/intelligence/incidents
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from convict.api.deps import get_db
from convict.engines.knowledge.tank_knowledge_engine import require_tank
from convict.models.behavior_event import BehaviorEvent
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


@router.get("/incidents")
async def get_incidents(
    hours: int  = Query(48, le=168),
    limit: int  = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Groups behavior_events into incidents: clusters of events sharing at least
    one fish within a 10-minute sliding window.

    Returns incidents sorted newest-first, each with:
      started_at, ended_at, duration_seconds
      involved_fish: [{fish_id, fish_name}]
      chain: ["harassment", "lethargy", ...]  — event sequence
      severity: max severity across events
      narrative: one-line summary
      event_count
    """
    tank  = await require_tank(db)
    since = datetime.utcnow() - timedelta(hours=hours)

    rows = (await db.execute(
        select(BehaviorEvent)
        .where(
            BehaviorEvent.tank_id     == tank.id,
            BehaviorEvent.occurred_at >= since,
            BehaviorEvent.event_type  != "vlm_observation",  # exclude VLM noise
        )
        .order_by(BehaviorEvent.occurred_at)
    )).scalars().all()

    incidents = _group_incidents(rows)
    # Newest first, capped
    incidents.sort(key=lambda i: i["started_at"], reverse=True)
    return incidents[:limit]


# ── Incident grouping logic ──────────────────────────────────────────────────

_INCIDENT_WINDOW = timedelta(minutes=10)

_SEV_RANK = {"high": 3, "medium": 2, "low": 1}

_CHAIN_CONTEXT = {
    frozenset(["harassment", "lethargy"]):   "stress escalation",
    frozenset(["harassment", "hiding"]):     "conflict + retreat",
    frozenset(["harassment"]):               "sustained conflict",
    frozenset(["missing_fish"]):             "disappearance",
    frozenset(["lethargy"]):                 "lethargy episode",
    frozenset(["hyperactivity"]):            "hyperactivity episode",
    frozenset(["lethargy", "hyperactivity"]):"erratic behavior",
}


def _fish_set(event: BehaviorEvent) -> set[str]:
    fish = json.loads(event.involved_fish or "[]")
    return {f["fish_id"] for f in fish if f.get("fish_id")}


def _group_incidents(events: list[BehaviorEvent]) -> list[dict]:
    if not events:
        return []

    groups: list[list[BehaviorEvent]] = []
    current: list[BehaviorEvent] = [events[0]]
    current_fish = _fish_set(events[0])

    for ev in events[1:]:
        ev_fish  = _fish_set(ev)
        time_gap = ev.occurred_at - current[-1].occurred_at
        overlaps = bool(ev_fish & current_fish)

        if time_gap <= _INCIDENT_WINDOW and overlaps:
            current.append(ev)
            current_fish |= ev_fish
        else:
            groups.append(current)
            current      = [ev]
            current_fish = ev_fish

    groups.append(current)

    # Build incident dicts — include single-event groups only for high severity
    incidents = []
    for grp in groups:
        if len(grp) == 1 and _SEV_RANK.get(grp[0].severity, 0) < 3:
            continue  # skip single low/medium-severity events

        all_fish: dict[str, str] = {}
        for ev in grp:
            for f in json.loads(ev.involved_fish or "[]"):
                if f.get("fish_id"):
                    all_fish[f["fish_id"]] = f.get("fish_name", "?")

        chain = [ev.event_type for ev in grp]
        max_sev = max(grp, key=lambda e: _SEV_RANK.get(e.severity, 0)).severity

        started  = grp[0].occurred_at
        ended    = grp[-1].occurred_at
        duration = (ended - started).total_seconds()

        # Narrative
        chain_set = frozenset(set(chain))
        context   = next(
            (v for k, v in _CHAIN_CONTEXT.items() if k <= chain_set),
            "behavioral incident",
        )
        fish_names = list(all_fish.values())[:2]
        fish_str   = " & ".join(fish_names) + (" + more" if len(all_fish) > 2 else "")
        narrative  = f"{fish_str}: {context}" if fish_str else context

        incidents.append({
            "started_at":      started.isoformat(),
            "ended_at":        ended.isoformat(),
            "duration_seconds": duration,
            "involved_fish":   [{"fish_id": k, "fish_name": v} for k, v in all_fish.items()],
            "chain":           chain,
            "severity":        max_sev,
            "narrative":       narrative,
            "event_count":     len(grp),
        })

    return incidents


def _fish_node(f: KnownFish) -> dict:
    return {
        "id":          f.uuid,
        "name":        f.name,
        "species":     f.species or "",
        "temperament": f.temperament or "peaceful",
        "size_class":  f.size_class or "medium",
    }
