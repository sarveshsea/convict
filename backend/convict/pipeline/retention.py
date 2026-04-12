"""
Nightly retention — purges old behavior_events, interaction_edges, and
detection_frame rows so the SQLite file doesn't grow without bound.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import text

from convict.config import settings

log = logging.getLogger("convict.retention")

last_run: dict | None = None


# Tables to purge: (table_name, timestamp_column, days_setting_attr)
_TABLES = [
    ("behavior_events",   "occurred_at", "retention_behavior_events_days"),
    ("interaction_edges", "occurred_at", "retention_interaction_edges_days"),
    ("detection_frames",  "captured_at", "retention_detection_frame_days"),
]


async def run_retention(db) -> dict:
    """
    Runs the purge inside an existing session (does NOT commit; caller commits).
    Returns counts per table plus an iso8601 timestamp.
    """
    result: dict = {
        "behavior_events_deleted":   0,
        "interaction_edges_deleted": 0,
        "detection_frame_deleted":   0,
        "ran_at": datetime.utcnow().isoformat() + "Z",
    }

    key_map = {
        "behavior_events":   "behavior_events_deleted",
        "interaction_edges": "interaction_edges_deleted",
        "detection_frames":  "detection_frame_deleted",
    }

    for table, ts_col, attr in _TABLES:
        days = int(getattr(settings, attr, 0) or 0)
        if days <= 0:
            continue
        try:
            res = await db.execute(
                text(f"DELETE FROM {table} WHERE {ts_col} < datetime('now', :cutoff)"),
                {"cutoff": f"-{days} days"},
            )
            deleted = int(getattr(res, "rowcount", 0) or 0)
            result[key_map[table]] = deleted
            log.info("retention: purged %d row(s) from %s (older than %d days)", deleted, table, days)
        except Exception:
            # Table may not exist yet, or column name mismatch — log and continue
            log.exception("retention: skipping %s (likely missing table or column)", table)

    return result


async def retention_loop() -> None:
    """
    Background task: sleeps until next 03:00 local, runs retention, repeats.
    On error, logs and retries in 1h.
    """
    global last_run
    from convict.database import AsyncSessionLocal

    log.info("retention loop started (run hour=%d local)", settings.retention_run_hour)

    while True:
        try:
            sleep_s = _seconds_until_next_run(settings.retention_run_hour)
            log.info("retention: next run in %.0f minutes", sleep_s / 60.0)
            await asyncio.sleep(sleep_s)

            async with AsyncSessionLocal() as db:
                summary = await run_retention(db)
                try:
                    await db.commit()
                except Exception:
                    log.exception("retention: commit failed — rolling back")
                    await db.rollback()
                    raise

            last_run = summary
            log.info("retention: run complete %s", summary)

        except asyncio.CancelledError:
            log.info("retention loop cancelled")
            break
        except Exception:
            log.exception("retention: loop error — retrying in 1h")
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                break


def _seconds_until_next_run(hour: int) -> float:
    """Seconds from now until the next occurrence of HH:00 local time."""
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return max(60.0, (target - now).total_seconds())
