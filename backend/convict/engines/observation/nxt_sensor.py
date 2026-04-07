"""
NXT color-sensor ambient-light reader.

Runs as a daemon thread — silently no-ops if nxt-python is not installed
or no brick is reachable over Bluetooth/USB. Exposes is_night: bool | None
so the frame processor can use it as a hard override over frame-brightness
night detection.

Usage:
  pip install nxt-python
  Pair NXT via macOS Bluetooth, plug color sensor into port 1, turn brick on.
  The manager auto-connects on start() and retries every 30s if disconnected.
"""
from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger(__name__)

_PORT_MAP = {1: None, 2: None, 3: None, 4: None}  # filled lazily after import


class NXTSensorManager:
    """
    Polls the NXT 2.0 Color Sensor in ambient-light mode (no LED) every 3s.
    Thread-safe — is_night and ambient_lux can be read from any thread.
    """

    def __init__(self, settings):
        self._settings  = settings
        self._ambient: int | None = None
        self._stop      = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock      = threading.Lock()

    # ------------------------------------------------------------------

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="nxt-sensor"
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # ------------------------------------------------------------------

    @property
    def is_night(self) -> bool | None:
        """
        None  — no NXT connected; fall back to frame-brightness detection.
        True  — ambient lux below threshold; nighttime pipeline active.
        False — enough light; daytime pipeline active.
        """
        with self._lock:
            if self._ambient is None:
                return None
            return self._ambient < self._settings.nxt_night_lux_threshold

    @property
    def ambient_lux(self) -> int | None:
        with self._lock:
            return self._ambient

    # ------------------------------------------------------------------

    def _run(self) -> None:
        try:
            import nxt.locator
            from nxt.sensor import Color20, Port, Type  # type: ignore[import]
        except ImportError:
            log.debug("nxt-python not installed — NXT sensor disabled")
            return

        port_num = getattr(self._settings, "nxt_sensor_port", 1)
        port_map = {1: Port.S1, 2: Port.S2, 3: Port.S3, 4: Port.S4}
        port     = port_map.get(port_num, Port.S1)

        while not self._stop.is_set():
            brick  = None
            sensor = None

            # --- connect ---
            try:
                brick  = nxt.locator.find()
                info   = brick.get_device_info()
                log.info("NXT connected: %s", info[0])
                sensor = Color20(brick, port)
                sensor.set_light_color(Type.COLOR_NONE)   # ambient mode, LED off
                log.info("NXT color sensor active on S%d (ambient mode)", port_num)
            except Exception as exc:
                log.debug("NXT not found, retrying in 30s: %s", exc)
                self._stop.wait(30.0)
                continue

            # --- poll ---
            while not self._stop.is_set():
                try:
                    reading = sensor.get_lightness()
                    with self._lock:
                        self._ambient = reading
                except Exception as exc:
                    log.warning("NXT read error, reconnecting: %s", exc)
                    with self._lock:
                        self._ambient = None
                    break   # fall back to outer reconnect loop
                self._stop.wait(3.0)

        with self._lock:
            self._ambient = None


# Module-level singleton — imported by frame_processor and orchestrator
from convict.config import settings as _settings  # noqa: E402
nxt_manager = NXTSensorManager(_settings)
