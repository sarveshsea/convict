"""
Camera capture — OpenCV thread → asyncio.Queue(maxsize=2).

Two implementations share the same interface:
  CameraCapture    — reads from a real USB camera (production, Yoga 6)
  MockCameraCapture — generates synthetic frames with moving fish-shaped
                      rectangles (development, no hardware required)

Set MOCK_CAMERA=1 in .env.local to use mock mode.
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Mock fish physics
# ---------------------------------------------------------------------------

class _MockFish:
    __slots__ = ("cx", "cy", "w", "h", "color_bgr", "vx", "vy")

    def __init__(
        self,
        cx: float,
        cy: float,
        w: float,
        h: float,
        color_bgr: tuple[int, int, int],
        vx: float | None = None,
        vy: float | None = None,
    ):
        rng = np.random.default_rng()
        self.cx, self.cy = cx, cy
        self.w, self.h = w, h
        self.color_bgr = color_bgr
        self.vx = float(vx if vx is not None else rng.uniform(-3.0, 3.0))
        self.vy = float(vy if vy is not None else rng.uniform(-2.0, 2.0))

    def bbox(self) -> tuple[int, int, int, int]:
        x1 = max(0, int(self.cx - self.w / 2))
        y1 = max(0, int(self.cy - self.h / 2))
        x2 = x1 + int(self.w)
        y2 = y1 + int(self.h)
        return x1, y1, x2, y2


# ---------------------------------------------------------------------------
# Mock camera
# ---------------------------------------------------------------------------

class MockCameraCapture:
    """
    Generates synthetic 640×480 frames at 30fps. Five coloured rectangles
    move around using Brownian-motion physics and bounce off the walls,
    mimicking fish in a tank.
    """

    FRAME_W = 640
    FRAME_H = 480

    _FISH_DEFS: list[dict] = [
        {"cx": 150, "cy": 200, "w": 80,  "h": 40, "color_bgr": (80,  150, 200)},  # orange
        {"cx": 420, "cy": 340, "w": 90,  "h": 45, "color_bgr": (180, 200, 80)},   # teal
        {"cx": 310, "cy": 140, "w": 60,  "h": 30, "color_bgr": (200, 80,  150)},  # purple
        {"cx": 510, "cy": 240, "w": 75,  "h": 38, "color_bgr": (80,  200, 200)},  # yellow
        {"cx": 100, "cy": 390, "w": 65,  "h": 33, "color_bgr": (200, 120, 80)},   # blue
    ]

    def __init__(self, settings, loop: asyncio.AbstractEventLoop, queue: "asyncio.Queue[np.ndarray]"):
        self._settings = settings
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()
        self._fish = [_MockFish(**d) for d in self._FISH_DEFS]
        self._lock = threading.Lock()
        self._detections: list[tuple[int, int, int, int]] = []
        self._thread: threading.Thread | None = None
        self._active = False

    # -- public API --

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

    def get_detections(self) -> list[tuple[int, int, int, int]]:
        """Return current (x1,y1,x2,y2) bboxes for all mock fish."""
        with self._lock:
            return list(self._detections)

    # -- internals --

    def _step_fish(self, fish: _MockFish) -> None:
        rng = np.random
        fish.vx += rng.normal(0, 0.4)
        fish.vy += rng.normal(0, 0.3)
        fish.vx = float(np.clip(fish.vx, -6.0, 6.0))
        fish.vy = float(np.clip(fish.vy, -4.0, 4.0))
        fish.cx += fish.vx
        fish.cy += fish.vy
        hw, hh = fish.w / 2, fish.h / 2
        if fish.cx - hw < 0:
            fish.cx = hw;         fish.vx =  abs(fish.vx)
        if fish.cx + hw > self.FRAME_W:
            fish.cx = self.FRAME_W - hw; fish.vx = -abs(fish.vx)
        if fish.cy - hh < 0:
            fish.cy = hh;         fish.vy =  abs(fish.vy)
        if fish.cy + hh > self.FRAME_H:
            fish.cy = self.FRAME_H - hh; fish.vy = -abs(fish.vy)

    def _run(self) -> None:
        while not self._stop.is_set():
            for fish in self._fish:
                self._step_fish(fish)

            # Build frame
            frame = np.full((self.FRAME_H, self.FRAME_W, 3), (22, 18, 15), dtype=np.uint8)

            dets: list[tuple[int, int, int, int]] = []
            for fish in self._fish:
                x1, y1, x2, y2 = fish.bbox()
                h_box = y2 - y1
                # Body
                cv2.rectangle(frame, (x1, y1), (x2, y2), fish.color_bgr, -1)
                # Lighter highlight on top third
                hi = tuple(min(255, c + 50) for c in fish.color_bgr)
                cv2.rectangle(frame, (x1, y1), (x2, y1 + h_box // 3), hi, -1)  # type: ignore[arg-type]
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
            pass  # intentional drop — pipeline is keeping up


# ---------------------------------------------------------------------------
# Real camera
# ---------------------------------------------------------------------------

class CameraCapture:
    """OpenCV USB camera capture in a daemon thread."""

    def __init__(self, settings, loop: asyncio.AbstractEventLoop, queue: "asyncio.Queue[np.ndarray]"):
        self._settings = settings
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active = False
        self._cap: cv2.VideoCapture | None = None

    def start(self) -> None:
        self._stop.clear()
        self._active = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="camera-capture")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._active = False

    @property
    def is_active(self) -> bool:
        return self._active

    def get_detections(self) -> None:
        """Real camera has no pre-computed detections."""
        return None

    def set_night_mode(self, night: bool) -> None:
        """
        Adjust exposure and gain for day/night.
        Values are camera-specific — Logitech cameras respond to these via
        AVFoundation but may silently ignore unsupported props.
        Set day_exposure / night_exposure to -1 in config to leave on auto.
        """
        if self._cap is None:
            return
        exp  = self._settings.night_exposure if night else self._settings.day_exposure
        gain = self._settings.night_gain     if night else self._settings.day_gain
        if exp != -1.0:
            self._cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)  # manual mode
            self._cap.set(cv2.CAP_PROP_EXPOSURE, exp)
        else:
            self._cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75)  # restore auto
        if gain != -1.0:
            self._cap.set(cv2.CAP_PROP_GAIN, gain)

    def _run(self) -> None:
        cap = cv2.VideoCapture(self._settings.camera_index, cv2.CAP_AVFOUNDATION)
        if not cap.isOpened():
            # Fallback: try without explicit backend
            cap = cv2.VideoCapture(self._settings.camera_index)
        if not cap.isOpened():
            self._active = False
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  self._settings.capture_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._settings.capture_height)
        cap.set(cv2.CAP_PROP_FPS,          30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
        # Disable auto white balance — we correct in software per frame
        cap.set(cv2.CAP_PROP_AUTO_WB, 0)
        self._cap = cap

        # macOS AVFoundation needs a warm-up burst before frames are ready
        for _ in range(10):
            cap.grab()
            time.sleep(0.05)

        while not self._stop.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue
            self._loop.call_soon_threadsafe(self._try_put, frame)

        cap.release()
        self._active = False

    def _try_put(self, frame) -> None:
        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            pass  # intentional drop
