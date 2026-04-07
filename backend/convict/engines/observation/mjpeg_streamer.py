"""
MJPEG streamer — holds the latest annotated JPEG and streams it as
multipart/x-mixed-replace to any connected browser client.

Uses a simple poll with asyncio.sleep(0.05) rather than a Condition
to avoid lock-cancellation edge cases when asyncio.wait_for times out.
At 5fps output the 50ms poll overhead is negligible.
"""
from __future__ import annotations

import asyncio
from typing import AsyncGenerator


class MJPEGStreamer:
    def __init__(self):
        self._frame: bytes | None = None
        self._last_frame_at: float = 0.0

    @property
    def is_active(self) -> bool:
        """True if a frame has arrived in the last 3 seconds."""
        import time
        return (time.monotonic() - self._last_frame_at) < 3.0

    async def push(self, jpeg_bytes: bytes) -> None:
        """Called by FrameProcessor after each encoded frame."""
        import time
        self._frame = jpeg_bytes
        self._last_frame_at = time.monotonic()

    async def frames(self) -> AsyncGenerator[bytes, None]:
        """
        Async generator consumed by the /stream/video StreamingResponse.
        Yields a multipart boundary chunk whenever a new frame is available.
        """
        last: bytes | None = None

        while True:
            frame = self._frame
            if frame is not None and frame is not last:
                last = frame
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame
                    + b"\r\n"
                )
            else:
                await asyncio.sleep(0.05)


streamer = MJPEGStreamer()
streamer2 = MJPEGStreamer()
