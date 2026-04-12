"""
GET /api/v1/health — composite health snapshot for the dashboard Health tab.
Surfaces things the WS pipeline_status feed doesn't: per-task heartbeats,
ffmpeg state, Ollama reachability, plug states, DB size, retention status.
"""
from __future__ import annotations

import logging
import os
import time

from fastapi import APIRouter
from sqlalchemy import text

from convict.config import settings
from convict.database import AsyncSessionLocal

log = logging.getLogger("convict.health")

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def get_health() -> dict:
    from convict.pipeline.orchestrator import orchestrator
    from convict.pipeline.db_writer import db_writer
    from convict.pipeline import retention as _retention
    from convict.engines.observation.hls_streamer import hls_streamer, hls_streamer2
    from convict.engines.control.device_controller import controller as device_controller

    # ── tasks ─────────────────────────────────────────────────────────
    try:
        tasks = orchestrator.task_health()
    except Exception:
        log.exception("health: orchestrator.task_health failed")
        tasks = {}

    # ── ffmpeg ────────────────────────────────────────────────────────
    def _ff_state(streamer) -> tuple[str, int | None]:
        proc = getattr(streamer, "_pipe", None)
        if proc is None:
            return ("stopped", None)
        try:
            running = proc.poll() is None
        except Exception:
            running = False
        return ("running" if running else "stopped", proc.pid if running else None)

    s1, p1 = _ff_state(hls_streamer)
    s2, p2 = _ff_state(hls_streamer2)
    ffmpeg = {"hls1": s1, "hls2": s2, "hls1_pid": p1, "hls2_pid": p2}

    # ── ollama ────────────────────────────────────────────────────────
    if settings.vlm_enabled:
        ollama: dict = {
            "enabled":    True,
            "reachable":  False,
            "latency_ms": None,
            "model":      settings.vlm_model,
        }
        try:
            import httpx
            t0 = time.monotonic()
            r = httpx.get(f"{settings.vlm_ollama_url}/api/tags", timeout=2.0)
            elapsed = (time.monotonic() - t0) * 1000.0
            if r.status_code == 200:
                ollama["reachable"]  = True
                ollama["latency_ms"] = round(elapsed, 1)
        except Exception:
            pass
    else:
        ollama = {
            "enabled":    False,
            "reachable":  False,
            "latency_ms": None,
            "model":      settings.vlm_model,
        }

    # ── plugs ─────────────────────────────────────────────────────────
    plugs: list[dict] = []
    try:
        for state in device_controller._plugs.values():
            plugs.append({
                "label":     state.label,
                "ip":        state.ip,
                "reachable": state.reachable,
                "is_on":     state.is_on,
            })
    except Exception:
        log.exception("health: failed to read plug states")

    # ── db ────────────────────────────────────────────────────────────
    db_block: dict = {
        "size_mb":              0.0,
        "behavior_events":      0,
        "interaction_edges":    0,
        "behavior_baselines":   0,
        "last_retention_run":   None,
        "last_retention_deleted": None,
    }
    try:
        db_block["size_mb"] = round(os.path.getsize(settings.db_path) / 1024 / 1024, 2)
    except Exception:
        pass

    try:
        async with AsyncSessionLocal() as db:
            for tbl, key in [
                ("behavior_events",    "behavior_events"),
                ("interaction_edges",  "interaction_edges"),
                ("behavior_baselines", "behavior_baselines"),
            ]:
                try:
                    res = await db.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
                    db_block[key] = int(res.scalar() or 0)
                except Exception:
                    pass
    except Exception:
        log.exception("health: db count query failed")

    if _retention.last_run:
        db_block["last_retention_run"] = _retention.last_run.get("ran_at")
        db_block["last_retention_deleted"] = {
            "behavior_events_deleted":   _retention.last_run.get("behavior_events_deleted", 0),
            "interaction_edges_deleted": _retention.last_run.get("interaction_edges_deleted", 0),
            "detection_frame_deleted":   _retention.last_run.get("detection_frame_deleted", 0),
        }

    return {
        "version": "0.1.0",
        "tasks":   tasks,
        "ffmpeg":  ffmpeg,
        "ollama":  ollama,
        "plugs":   plugs,
        "db":      db_block,
        "writer":  db_writer.stats(),
    }
