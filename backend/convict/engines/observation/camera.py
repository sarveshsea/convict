"""
Camera capture — OpenCV thread → asyncio.Queue(maxsize=2).

Two implementations share the same interface:
  CameraCapture     — reads from a real USB camera (production)
  MockCameraCapture — generates synthetic frames (dev, no hardware)

Set MOCK_CAMERA=1 in .env.local to use mock mode.

Camera resilience strategy
--------------------------
  - Exponential backoff on reopen (0.5s → 1s → 2s → 4s → max 30s)
  - Thread never exits on hardware failures — loops until stop() is called
  - is_active stays False during recovery so orchestrator watchdog can react
  - Watchdog in orchestrator (separate from this class) restarts the whole
    pipeline if is_active is False for > CAMERA_DEAD_TIMEOUT seconds
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("convict.camera")

_MAX_BACKOFF   = 30.0   # seconds between reopen attempts at worst
_INIT_BACKOFF  = 0.5    # starting backoff
_WARMUP_FRAMES = 10     # grab() calls before first real read


# ---------------------------------------------------------------------------
# Mock fish physics
# ---------------------------------------------------------------------------

class _MockFish:
    __slots__ = ("cx", "cy", "w", "h", "color_bgr", "vx", "vy")

    def __init__(self, cx, cy, w, h, color_bgr, vx=None, vy=None):
        rng = np.random.default_rng()
        self.cx, self.cy = cx, cy
        self.w, self.h = w, h
        self.color_bgr = color_bgr
        self.vx = float(vx if vx is not None else rng.uniform(-3.0, 3.0))
        self.vy = float(vy if vy is not None else rng.uniform(-2.0, 2.0))

    def bbox(self):
        x1 = max(0, int(self.cx - self.w / 2))
        y1 = max(0, int(self.cy - self.h / 2))
        return x1, y1, x1 + int(self.w), y1 + int(self.h)


# ---------------------------------------------------------------------------
# Mock camera
# ---------------------------------------------------------------------------

class MockCameraCapture:
    FRAME_W = 640
    FRAME_H = 480

    _FISH_DEFS = [
        {"cx": 150, "cy": 200, "w": 80,  "h": 40, "color_bgr": (80,  150, 200)},
        {"cx": 420, "cy": 340, "w": 90,  "h": 45, "color_bgr": (180, 200, 80)},
        {"cx": 310, "cy": 140, "w": 60,  "h": 30, "color_bgr": (200, 80,  150)},
        {"cx": 510, "cy": 240, "w": 75,  "h": 38, "color_bgr": (80,  200, 200)},
        {"cx": 100, "cy": 390, "w": 65,  "h": 33, "color_bgr": (200, 120, 80)},
    ]

    def __init__(self, settings, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._settings = settings
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()
        self._fish = [_MockFish(**d) for d in self._FISH_DEFS]
        self._lock = threading.Lock()
        self._detections: list = []
        self._thread: threading.Thread | None = None
        self._active = False

    def start(self) -> None:
        self._stop.clear()
        self._active = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="mock-camera")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._active = False

    @property
    def is_active(self) -> bool:
        return self._active

    def get_detections(self):
        with self._lock:
            return list(self._detections)

    def _step_fish(self, fish: _MockFish) -> None:
        fish.vx += np.random.normal(0, 0.4)
        fish.vy += np.random.normal(0, 0.3)
        fish.vx = float(np.clip(fish.vx, -6.0, 6.0))
        fish.vy = float(np.clip(fish.vy, -4.0, 4.0))
        fish.cx += fish.vx
        fish.cy += fish.vy
        hw, hh = fish.w / 2, fish.h / 2
        if fish.cx - hw < 0:   fish.cx = hw;                 fish.vx =  abs(fish.vx)
        if fish.cx + hw > self.FRAME_W: fish.cx = self.FRAME_W - hw; fish.vx = -abs(fish.vx)
        if fish.cy - hh < 0:   fish.cy = hh;                 fish.vy =  abs(fish.vy)
        if fish.cy + hh > self.FRAME_H: fish.cy = self.FRAME_H - hh; fish.vy = -abs(fish.vy)

    def _run(self) -> None:
        while not self._stop.is_set():
            for fish in self._fish:
                self._step_fish(fish)
            frame = np.full((self.FRAME_H, self.FRAME_W, 3), (22, 18, 15), dtype=np.uint8)
            dets = []
            for fish in self._fish:
                x1, y1, x2, y2 = fish.bbox()
                h_box = y2 - y1
                cv2.rectangle(frame, (x1, y1), (x2, y2), fish.color_bgr, -1)
                hi = tuple(min(255, c + 50) for c in fish.color_bgr)
                cv2.rectangle(frame, (x1, y1), (x2, y1 + h_box // 3), hi, -1)  # type: ignore
                dets.append((x1, y1, x2, y2))
            with self._lock:
                self._detections = dets
            self._loop.call_soon_threadsafe(self._try_put, frame)
            time.sleep(1 / 30)
        self._active = False

    def _try_put(self, frame) -> None:
        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass


# ---------------------------------------------------------------------------
# Real camera
# ---------------------------------------------------------------------------

class CameraCapture:
    """
    OpenCV USB camera capture in a daemon thread.

    Failure model
    -------------
    The _run() thread NEVER exits due to hardware errors. If the camera
    disconnects or fails, it enters a reopen loop with exponential backoff,
    sets is_active=False during recovery, then sets is_active=True again when
    frames start flowing. The orchestrator watchdog handles the case where
    recovery takes too long (> CAMERA_DEAD_TIMEOUT).
    """

    def __init__(self, settings, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._settings = settings
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active = False
        self._cap: cv2.VideoCapture | None = None
        self._preopen_cap: cv2.VideoCapture | None = None
        self._lock = threading.Lock()

    # ── Public API ─────────────────────────────────────────────────────

    def preopen(self) -> bool:
        cap = self._open_device(self._settings.camera_index)
        if not cap.isOpened():
            cap.release()
            return False
        self._preopen_cap = cap
        return True

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="camera-capture")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._active = False
        with self._lock:
            cap = self._cap
        if cap:
            cap.release()

    @property
    def is_active(self) -> bool:
        return self._active

    def get_detections(self):
        return None

    def set_night_mode(self, night: bool) -> None:
        with self._lock:
            cap = self._cap
        if cap is None:
            return
        exp  = getattr(self._settings, "night_exposure" if night else "day_exposure",  -1.0)
        gain = getattr(self._settings, "night_gain"     if night else "day_gain",      -1.0)
        if exp != -1.0:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
            cap.set(cv2.CAP_PROP_EXPOSURE, exp)
        else:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75)
        if gain != -1.0:
            cap.set(cv2.CAP_PROP_GAIN, gain)

    # ── Thread internals ───────────────────────────────────────────────

    def _configure(self, cap: cv2.VideoCapture) -> None:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  self._settings.capture_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._settings.capture_height)
        cap.set(cv2.CAP_PROP_FPS,          30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
        cap.set(cv2.CAP_PROP_AUTO_WB,      0)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

    def _try_open(self) -> cv2.VideoCapture | None:
        """Try to get a working VideoCapture. Returns None on failure."""
        # Use pre-opened cap if available
        with self._lock:
            pre = self._preopen_cap
            self._preopen_cap = None

        if pre is not None and pre.isOpened():
            self._configure(pre)
            for _ in range(_WARMUP_FRAMES):
                pre.grab(); time.sleep(0.03)
            return pre
        elif pre is not None:
            pre.release()

        cap = self._open_device(self._settings.camera_index)
        if not cap.isOpened():
            cap.release()
            return None
        self._configure(cap)
        for _ in range(_WARMUP_FRAMES):
            cap.grab(); time.sleep(0.03)
        return cap

    def _run(self) -> None:
        backoff = _INIT_BACKOFF

        # ── Initial open with backoff ───────────────────────────────────
        while not self._stop.is_set():
            cap = self._try_open()
            if cap is not None:
                break
            log.warning("Camera index %d not available — retry in %.1fs",
                        self._settings.camera_index, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)
        else:
            # stop() was called before we could open
            return

        with self._lock:
            self._cap = cap
        self._active = True
        backoff = _INIT_BACKOFF
        consecutive_failures = 0
        log.info("Camera %d opened — streaming", self._settings.camera_index)

        # ── Read loop ───────────────────────────────────────────────────
        while not self._stop.is_set():
            ret, frame = cap.read()

            if not ret or frame is None:
                consecutive_failures += 1

                if consecutive_failures == 5:
                    # Brief stall — mark inactive so status turns orange
                    self._active = False
                    log.warning("Camera %d: %d consecutive read failures",
                                self._settings.camera_index, consecutive_failures)

                if consecutive_failures >= 15:
                    # Hardware-level failure — release and reopen with backoff
                    log.error("Camera %d: hardware failure — reopening (backoff=%.1fs)",
                              self._settings.camera_index, backoff)
                    cap.release()
                    with self._lock:
                        self._cap = None

                    time.sleep(backoff)
                    backoff = min(backoff * 2, _MAX_BACKOFF)

                    new_cap = self._try_open()
                    if new_cap is not None:
                        cap = new_cap
                        with self._lock:
                            self._cap = cap
                        self._active = True
                        consecutive_failures = 0
                        backoff = _INIT_BACKOFF
                        log.info("Camera %d: reopened successfully", self._settings.camera_index)
                    # else: loop again — stay inactive, keep trying
                    continue

                time.sleep(0.03)
                continue

            # Good frame
            if consecutive_failures > 0:
                consecutive_failures = 0
                backoff = _INIT_BACKOFF
                if not self._active:
                    self._active = True
                    log.info("Camera %d: recovered", self._settings.camera_index)

            self._loop.call_soon_threadsafe(self._try_put, frame)

        # ── Cleanup ─────────────────────────────────────────────────────
        self._active = False
        with self._lock:
            if self._cap:
                self._cap.release()
                self._cap = None
        log.info("Camera %d thread exited", self._settings.camera_index)

    def _try_put(self, frame) -> None:
        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass

    def _open_device(self, camera_index: int) -> cv2.VideoCapture:
        """Pick platform-appropriate backend, fall back to default."""
        if sys.platform.startswith("win"):
            backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF]
        elif sys.platform == "darwin":
            backends = [cv2.CAP_AVFOUNDATION]
        else:
            backends = [cv2.CAP_V4L2]

        for backend in backends:
            cap = cv2.VideoCapture(camera_index, backend)
            if cap.isOpened():
                return cap
            cap.release()

        return cv2.VideoCapture(camera_index)
