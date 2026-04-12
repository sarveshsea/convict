"""
Insights API — visualization endpoints for the dashboard.

GET /api/v1/insights/clarity-history     — 24h clarity + flow time series
GET /api/v1/insights/feeding-response    — speed vs nearest feeding offset
GET /api/v1/insights/behavior-transitions — behavior event transition graph
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from convict.api.deps import get_db
from convict.engines.knowledge.tank_knowledge_engine import require_tank
from convict.models.behavior_baseline import BehaviorBaseline
from convict.models.behavior_event import BehaviorEvent
from convict.models.known_fish import KnownFish
from convict.models.schedule import Schedule

log = logging.getLogger("convict.insights")

router = APIRouter(prefix="/insights", tags=["insights"])


# ── E1. Clarity history ──────────────────────────────────────────────────

@router.get("/clarity-history")
async def clarity_history():
    from convict.pipeline.orchestrator import orchestrator
    flow = getattr(orchestrator, "_flow", None)
    if not flow:
        return {"samples": [], "current": None}
    history = flow.get_history()
    overlay = flow.get_overlay()
    return {
        "samples": history,
        "current": {
            "clarity":     overlay.get("clarity"),
            "flow_status": overlay.get("flow_status"),
        },
    }


# ── E2. Feeding-response curve ───────────────────────────────────────────

def _parse_days(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(d).lower()[:3] for d in raw]
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if isinstance(parsed, list):
        return [str(d).lower()[:3] for d in parsed]
    return []


_DOW_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@router.get("/feeding-response")
async def feeding_response(
    fish_uuid: str | None = None,
    days:      int        = Query(7, ge=1, le=60),
    db: AsyncSession      = Depends(get_db),
):
    """
    Mean speed at each minute offset from the nearest feeding event,
    aggregated across `days` of behavior_baseline rows.
    """
    tank = await require_tank(db)
    since = datetime.utcnow() - timedelta(days=days)

    # Schedules: just the feeding ones for this tank
    sched_rows = (await db.execute(
        select(Schedule).where(
            Schedule.tank_id    == tank.id,
            Schedule.event_type == "feeding",
        )
    )).scalars().all()

    empty = {
        "buckets":        [],
        "baseline_speed": None,
        "fish_uuid":      fish_uuid,
        "days":           days,
    }
    if not sched_rows:
        return empty

    # Pre-parse feeding times: list of (dow_set, minute_of_day)
    feedings: list[tuple[set[str], int]] = []
    for s in sched_rows:
        try:
            h, m = map(int, s.time_of_day.split(":"))
        except Exception:
            continue
        dow = set(_parse_days(s.days_of_week))
        if not dow:
            dow = set(_DOW_NAMES)  # daily
        feedings.append((dow, h * 60 + m))

    if not feedings:
        return empty

    # Baselines query — optionally scoped to one fish
    q = select(BehaviorBaseline).where(BehaviorBaseline.computed_at >= since)
    if fish_uuid:
        fish = (await db.execute(
            select(KnownFish).where(KnownFish.uuid == fish_uuid)
        )).scalar_one_or_none()
        if not fish:
            return empty
        q = q.where(BehaviorBaseline.fish_id == fish.id)

    baseline_rows = (await db.execute(q)).scalars().all()
    if not baseline_rows:
        return empty

    # Bucket by minute offset (5min buckets, ±30 clamp)
    bucket_speeds: dict[int, list[float]] = defaultdict(list)
    all_speeds: list[float] = []

    for row in baseline_rows:
        ts = row.computed_at
        if ts is None:
            continue
        dow = _DOW_NAMES[ts.weekday()]
        row_minute = ts.hour * 60 + ts.minute

        # Find nearest feeding for this dow
        best_offset: int | None = None
        for dow_set, feed_minute in feedings:
            if dow not in dow_set:
                continue
            offset = row_minute - feed_minute
            if best_offset is None or abs(offset) < abs(best_offset):
                best_offset = offset
        if best_offset is None:
            continue

        clamped = max(-30, min(30, best_offset))
        # 5-minute buckets aligned to multiples of 5
        bucket = (clamped // 5) * 5
        speed = float(row.mean_speed_px_per_frame or 0.0)
        bucket_speeds[bucket].append(speed)
        all_speeds.append(speed)

    buckets = [
        {
            "minutes_offset": k,
            "mean_speed":     round(sum(v) / len(v), 3),
            "n":              len(v),
        }
        for k, v in sorted(bucket_speeds.items())
    ]

    baseline_speed = round(sum(all_speeds) / len(all_speeds), 3) if all_speeds else None

    return {
        "buckets":        buckets,
        "baseline_speed": baseline_speed,
        "fish_uuid":      fish_uuid,
        "days":           days,
    }


# ── E3. Behavior transitions ─────────────────────────────────────────────

@router.get("/behavior-transitions")
async def behavior_transitions(
    hours:           int           = Query(168, ge=1, le=720),
    max_gap_minutes: int           = Query(30, ge=1, le=240),
    db:              AsyncSession  = Depends(get_db),
):
    """
    Counts of which behavior_event types follow which others within max_gap_minutes.
    Returns a node + edge list for Sankey/chord visualizations.
    """
    tank  = await require_tank(db)
    since = datetime.utcnow() - timedelta(hours=hours)

    rows = (await db.execute(
        select(BehaviorEvent)
        .where(
            BehaviorEvent.tank_id     == tank.id,
            BehaviorEvent.occurred_at >= since,
            BehaviorEvent.event_type  != "vlm_observation",
        )
        .order_by(BehaviorEvent.occurred_at)
    )).scalars().all()

    if not rows:
        return {"nodes": [], "edges": [], "window_hours": hours}

    node_counts: dict[str, int] = defaultdict(int)
    for r in rows:
        node_counts[r.event_type] += 1

    gap = timedelta(minutes=max_gap_minutes)
    # (src, dst) → list of gaps in seconds
    edge_gaps: dict[tuple[str, str], list[float]] = defaultdict(list)
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        if b.occurred_at - a.occurred_at <= gap:
            edge_gaps[(a.event_type, b.event_type)].append(
                (b.occurred_at - a.occurred_at).total_seconds()
            )

    nodes = [{"id": t, "count": c} for t, c in sorted(node_counts.items(), key=lambda x: -x[1])]
    edges = [
        {
            "source":           src,
            "target":           dst,
            "count":            len(gaps),
            "avg_gap_minutes":  round((sum(gaps) / len(gaps)) / 60.0, 2),
        }
        for (src, dst), gaps in sorted(edge_gaps.items(), key=lambda kv: -len(kv[1]))
    ]

    return {
        "nodes":        nodes,
        "edges":        edges,
        "window_hours": hours,
    }
