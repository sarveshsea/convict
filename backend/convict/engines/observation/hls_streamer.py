"""
HLS streamer — receives JPEG frames from FrameProcessor and pipes them into
ffmpeg to produce HLS segments (.m3u8 + .ts) in a temp directory.

The FastAPI stream router exposes GET /api/v1/stream/hls/{filename} to serve
these files as static content.

Architecture
============
  FrameProcessor.push(jpeg_bytes)
    └─► HLSStreamer.push(jpeg_bytes)          # called from async context
           └─► self._pipe.stdin.write(jpeg_bytes)  # ffmpeg stdin (image2pipe)
                 └─► ffmpeg produces /tmp/convict_hls/stream.m3u8 + *.ts

ffmpeg command:
  ffmpeg -f image2pipe -r 6 -i pipe:0
         -c:v libx264 -preset ultrafast -tune zerolatency
         -hls_time 1 -hls_list_size 3 -hls_flags delete_segments
         -f hls /tmp/convict_hls/stream.m3u8

Notes
=====
- If ffmpeg is not found on PATH, HLSStreamer degrades gracefully: push() is a
  no-op and is_active returns False.  The MJPEG endpoint continues working.
- The temp directory and ffmpeg process are managed entirely within this module;
  no external orchestration is required.
- Thread safety: push() is called from asyncio event-loop coroutines.  Writing
  to the subprocess stdin handle is non-blocking because we run ffmpeg in a
  separate process and the kernel pipe buffer absorbs small JPEG frames.
  For very large frames or slow disks, consider switching to asyncio
  create_subprocess_exec and using asyncio StreamWriter.write().
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Directory where HLS segments will be written.
# Placed in /tmp so it survives process restarts and is cleaned by the OS.
HLS_DIR = Path(tempfile.gettempdir()) / "convict_hls"
HLS_PLAYLIST = HLS_DIR / "stream.m3u8"

# Second-camera segments go in a sibling directory.
HLS_DIR_2 = Path(tempfile.gettempdir()) / "convict_hls2"
HLS_PLAYLIST_2 = HLS_DIR_2 / "stream.m3u8"

# How many frames per second we advertise to ffmpeg.
# The actual camera may run faster; ffmpeg will pace the output.
HLS_FPS = 6

# Seconds per HLS segment.
HLS_TIME = 1

# Number of segments kept in the playlist (older segments are deleted).
HLS_LIST_SIZE = 3


def _ffmpeg_cmd(output_playlist: Path) -> list[str]:
    return [
        "ffmpeg",
        "-y",                        # overwrite without asking
        "-f", "image2pipe",          # input: raw image stream via stdin
        "-r", str(HLS_FPS),
        "-i", "pipe:0",              # read from stdin
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",       # required for most players
        "-hls_time", str(HLS_TIME),
        "-hls_list_size", str(HLS_LIST_SIZE),
        "-hls_flags", "delete_segments+omit_endlist",
        "-f", "hls",
        str(output_playlist),
    ]


class HLSStreamer:
    """
    Accepts JPEG frames and forwards them to a long-running ffmpeg process
    that writes HLS segments into a temp directory.

    Usage:
        streamer = HLSStreamer()
        await streamer.push(jpeg_bytes)   # called per frame
        # serve files from streamer.hls_dir via FastAPI StaticFiles / FileResponse
    """

    def __init__(self, hls_dir: Path = HLS_DIR):
        self.hls_dir: Path = hls_dir
        self._pipe: Optional[subprocess.Popen] = None
        self._last_frame_at: float = 0.0
        self._ffmpeg_available: Optional[bool] = None  # lazily resolved

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def playlist_path(self) -> Path:
        return self.hls_dir / "stream.m3u8"

    @property
    def is_active(self) -> bool:
        """True if a frame has been pushed in the last 5 seconds."""
        return (time.monotonic() - self._last_frame_at) < 5.0

    @property
    def ffmpeg_ok(self) -> bool:
        """Whether ffmpeg was found on PATH (cached after first check)."""
        if self._ffmpeg_available is None:
            self._ffmpeg_available = shutil.which("ffmpeg") is not None
            if not self._ffmpeg_available:
                logger.warning(
                    "HLSStreamer: ffmpeg not found on PATH — "
                    "HLS output disabled.  Install ffmpeg to enable HLS streaming."
                )
        return self._ffmpeg_available

    async def push(self, jpeg_bytes: bytes) -> None:
        """
        Receive one annotated JPEG frame.  Starts ffmpeg on first call.
        No-op if ffmpeg is unavailable.
        """
        if not self.ffmpeg_ok:
            return

        if self._pipe is None or self._pipe.poll() is not None:
            self._start_ffmpeg()
            if self._pipe is None:
                return  # start failed

        try:
            # Write the raw JPEG bytes as one image to the image2pipe input.
            self._pipe.stdin.write(jpeg_bytes)  # type: ignore[union-attr]
            self._pipe.stdin.flush()             # type: ignore[union-attr]
            self._last_frame_at = time.monotonic()
        except (BrokenPipeError, OSError) as exc:
            logger.warning("HLSStreamer: pipe write failed (%s) — restarting ffmpeg", exc)
            self._stop_ffmpeg()

    def stop(self) -> None:
        """Cleanly terminate ffmpeg (call on shutdown)."""
        self._stop_ffmpeg()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _start_ffmpeg(self) -> None:
        """Launch ffmpeg as a subprocess writing HLS to self.hls_dir."""
        self.hls_dir.mkdir(parents=True, exist_ok=True)
        cmd = _ffmpeg_cmd(self.playlist_path)
        try:
            self._pipe = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,   # capture stderr for debugging
                bufsize=0,               # unbuffered — we flush manually
            )
            logger.info(
                "HLSStreamer: ffmpeg started (pid=%d), writing to %s",
                self._pipe.pid,
                self.playlist_path,
            )
        except FileNotFoundError:
            logger.error("HLSStreamer: could not start ffmpeg — FileNotFoundError")
            self._ffmpeg_available = False
            self._pipe = None
        except Exception as exc:
            logger.error("HLSStreamer: could not start ffmpeg — %s", exc)
            self._pipe = None

    def _stop_ffmpeg(self) -> None:
        if self._pipe is None:
            return
        try:
            self._pipe.stdin.close()  # type: ignore[union-attr]
        except Exception:
            pass
        try:
            self._pipe.terminate()
            self._pipe.wait(timeout=3)
        except Exception:
            try:
                self._pipe.kill()
            except Exception:
                pass
        self._pipe = None
        logger.info("HLSStreamer: ffmpeg stopped")


# Module-level singletons — one per camera, mirroring mjpeg_streamer.py
hls_streamer  = HLSStreamer(HLS_DIR)
hls_streamer2 = HLSStreamer(HLS_DIR_2)
