"""
Async DB writer — single consumer task that drains a queue of persistence
work items so the per-frame loop never blocks on commits.

Each work item is a coroutine factory: a callable that takes a db session
and returns an awaitable. The writer batches items by opening one session
per drain cycle and committing once per batch.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger("convict.db_writer")

_BATCH_MAX = 32

WorkItem = Callable[[Any], Awaitable[None]]


class DBWriter:
    def __init__(self, queue_max: int = 512):
        self._queue_max = queue_max
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self._running = False

        self._dropped:   int = 0
        self._committed: int = 0
        self._errors:    int = 0

    # ------------------------------------------------------------------

    def enqueue(self, fn: WorkItem) -> None:
        """Non-blocking enqueue. Drops the item (with a warning) if full."""
        if self._queue is None:
            # Writer not started — drop silently to avoid blowing up at import
            self._dropped += 1
            return
        try:
            self._queue.put_nowait(fn)
        except asyncio.QueueFull:
            self._dropped += 1
            log.warning(
                "DBWriter queue full (max=%d) — dropping work item (dropped total=%d)",
                self._queue_max, self._dropped,
            )

    async def start(self) -> None:
        if self._running:
            return
        self._queue = asyncio.Queue(maxsize=self._queue_max)
        self._running = True
        self._task = asyncio.create_task(self._run(), name="db-writer")
        log.info("DBWriter started (queue_max=%d, batch_max=%d)", self._queue_max, _BATCH_MAX)

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Drain anything left
        if self._queue is not None and not self._queue.empty():
            await self._drain_remaining()
        log.info(
            "DBWriter stopped (committed=%d, dropped=%d, errors=%d)",
            self._committed, self._dropped, self._errors,
        )

    def stats(self) -> dict:
        return {
            "queue_depth": self._queue.qsize() if self._queue is not None else 0,
            "dropped":     self._dropped,
            "committed":   self._committed,
            "errors":      self._errors,
        }

    # ------------------------------------------------------------------

    async def _run(self) -> None:
        from convict.database import AsyncSessionLocal

        try:
            while self._running:
                # Block until first item
                first = await self._queue.get()
                batch: list[WorkItem] = [first]

                # Drain whatever else is sitting in the queue, up to _BATCH_MAX
                while len(batch) < _BATCH_MAX + 1:
                    try:
                        batch.append(self._queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break

                async with AsyncSessionLocal() as db:
                    for fn in batch:
                        try:
                            await fn(db)
                        except Exception:
                            self._errors += 1
                            log.exception("DBWriter work item raised")
                    try:
                        await db.commit()
                        self._committed += len(batch)
                    except Exception:
                        self._errors += 1
                        log.exception("DBWriter batch commit failed — rolling back")
                        try:
                            await db.rollback()
                        except Exception:
                            pass
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("DBWriter loop crashed")

    async def _drain_remaining(self) -> None:
        from convict.database import AsyncSessionLocal

        items: list[WorkItem] = []
        while True:
            try:
                items.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        if not items:
            return
        async with AsyncSessionLocal() as db:
            for fn in items:
                try:
                    await fn(db)
                except Exception:
                    self._errors += 1
                    log.exception("DBWriter drain item raised")
            try:
                await db.commit()
                self._committed += len(items)
            except Exception:
                self._errors += 1
                log.exception("DBWriter drain commit failed")
                try:
                    await db.rollback()
                except Exception:
                    pass


db_writer = DBWriter()
