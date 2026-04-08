"""
DeviceController — manages TP-Link Kasa smart plugs.

Requires: pip install python-kasa
Configure in .env.local:
    KASA_PLUG_1_IP=192.168.1.100
    KASA_PLUG_1_LABEL=air_pump
    KASA_PLUG_2_IP=192.168.1.101
    KASA_PLUG_2_LABEL=light

Automatic responses to pipeline anomaly events:
    surface_gathering    → turn_on("air_pump")   — boost O₂
    flow_stalled         → broadcast warning (can't fix filter from here)
    feeding_indifference → no action (health warning only)

Manual control via DeviceController.turn_on/off/toggle(label) — called by API.

All operations are non-blocking (python-kasa is fully async).
Unreachable/offline plugs are silently skipped so the pipeline keeps running.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("convict.devices")

# How long (seconds) to wait before auto-turning OFF the air pump after
# a surface_gathering event clears (no new event for this window).
_AIR_PUMP_AUTO_OFF_S = 600   # 10 minutes

# Minimum seconds between any automated on/off commands per plug (prevent thrashing)
_COMMAND_COOLDOWN_S = 60


@dataclass
class PlugState:
    label:      str
    ip:         str
    is_on:      bool         = False
    reachable:  bool         = False
    last_seen:  float        = 0.0     # monotonic timestamp of last successful poll
    last_cmd:   float        = 0.0     # monotonic timestamp of last command issued
    _plug:      object       = field(default=None, repr=False)  # kasa.SmartPlug instance


class DeviceController:
    """
    Singleton — access via module-level `controller`.

    Usage:
        await controller.initialize()    # called at startup
        await controller.on_anomaly(ev)  # called per anomaly event from orchestrator
        await controller.turn_on("air_pump")
        await controller.turn_off("air_pump")
        state = controller.get_state()   # list[dict] for API
    """

    def __init__(self, settings):
        self._s     = settings
        self._plugs: dict[str, PlugState] = {}
        self._ready = False

        # Track when we last saw a surface_gathering event (for auto-off logic)
        self._last_surface_event: float = 0.0
        self._auto_off_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """
        Build plug registry from settings and attempt an initial state poll.
        Safe to call even if python-kasa is not installed — will log a warning
        and leave the controller in a no-op state.
        """
        try:
            from kasa import SmartPlug  # type: ignore[import]
        except ImportError:
            log.warning(
                "DeviceController: python-kasa not installed. "
                "Install with: pip install python-kasa"
            )
            return

        pairs = [
            (self._s.kasa_plug_1_ip, self._s.kasa_plug_1_label),
            (self._s.kasa_plug_2_ip, self._s.kasa_plug_2_label),
        ]
        for ip, label in pairs:
            if not ip:
                continue
            plug_obj = SmartPlug(ip)
            state = PlugState(label=label, ip=ip, _plug=plug_obj)
            self._plugs[label] = state
            log.info("DeviceController: registered plug '%s' @ %s", label, ip)

        if not self._plugs:
            log.info("DeviceController: no plugs configured (set KASA_PLUG_*_IP in .env.local)")
            return

        self._ready = True
        # Initial poll — don't fail startup if plugs are offline
        await self._poll_all()

    async def shutdown(self) -> None:
        if self._auto_off_task and not self._auto_off_task.done():
            self._auto_off_task.cancel()
            try:
                await self._auto_off_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------------
    # Anomaly event handler
    # ------------------------------------------------------------------

    async def on_anomaly(self, event: dict) -> None:
        """
        Called by orchestrator for every anomaly event.
        Handles automatic device responses.
        """
        if not self._ready:
            return

        ev_type = event.get("event_type", "")

        if ev_type == "surface_gathering":
            self._last_surface_event = time.monotonic()
            await self._auto_air_pump_on()

        elif ev_type == "synchronized_stress":
            # Synchronized stress may indicate O₂ issue too — same response
            await self._auto_air_pump_on()

    async def _auto_air_pump_on(self) -> None:
        """Turn on air pump with cooldown guard, schedule auto-off."""
        if "air_pump" not in self._plugs:
            return

        state = self._plugs["air_pump"]
        now   = time.monotonic()

        if state.is_on:
            # Already on — just refresh the auto-off timer
            self._schedule_air_pump_auto_off()
            return

        if now - state.last_cmd < _COMMAND_COOLDOWN_S:
            return   # too soon since last command

        log.info("DeviceController: auto turning ON air_pump (surface/stress event)")
        await self._send_command("air_pump", on=True, source="auto")
        self._schedule_air_pump_auto_off()

    def _schedule_air_pump_auto_off(self) -> None:
        """(Re)schedule an auto-off for the air pump after the quiet period."""
        if self._auto_off_task and not self._auto_off_task.done():
            self._auto_off_task.cancel()
        self._auto_off_task = asyncio.create_task(self._air_pump_auto_off_worker())

    async def _air_pump_auto_off_worker(self) -> None:
        try:
            await asyncio.sleep(_AIR_PUMP_AUTO_OFF_S)
            # Only turn off if no new surface event arrived during the sleep
            if time.monotonic() - self._last_surface_event >= _AIR_PUMP_AUTO_OFF_S - 5:
                log.info("DeviceController: auto turning OFF air_pump (quiet period elapsed)")
                await self._send_command("air_pump", on=False, source="auto")
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # Public control API
    # ------------------------------------------------------------------

    async def turn_on(self, label: str) -> dict:
        return await self._send_command(label, on=True, source="manual")

    async def turn_off(self, label: str) -> dict:
        return await self._send_command(label, on=False, source="manual")

    async def toggle(self, label: str) -> dict:
        if label not in self._plugs:
            return {"ok": False, "error": f"unknown plug '{label}'"}
        await self._poll(self._plugs[label])
        on = not self._plugs[label].is_on
        return await self._send_command(label, on=on, source="manual")

    def get_state(self) -> list[dict]:
        return [
            {
                "label":     s.label,
                "ip":        s.ip,
                "is_on":     s.is_on,
                "reachable": s.reachable,
                "last_seen": s.last_seen,
            }
            for s in self._plugs.values()
        ]

    def is_ready(self) -> bool:
        return self._ready

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _send_command(self, label: str, on: bool, source: str = "manual") -> dict:
        if label not in self._plugs:
            return {"ok": False, "error": f"unknown plug '{label}'"}

        state = self._plugs[label]
        try:
            plug = state._plug
            await plug.update()
            if on:
                await plug.turn_on()
            else:
                await plug.turn_off()
            state.is_on    = on
            state.reachable = True
            state.last_seen = time.monotonic()
            state.last_cmd  = time.monotonic()
            log.info(
                "DeviceController: %s '%s' (%s, source=%s)",
                "ON" if on else "OFF", label, state.ip, source,
            )
            # Broadcast state change via WS
            await _broadcast_device_state(state)
            return {"ok": True, "label": label, "is_on": on}
        except Exception as exc:
            state.reachable = False
            log.warning("DeviceController: command to '%s' failed — %s", label, exc)
            return {"ok": False, "error": str(exc), "label": label}

    async def _poll(self, state: PlugState) -> None:
        try:
            await state._plug.update()
            state.is_on     = state._plug.is_on
            state.reachable = True
            state.last_seen = time.monotonic()
        except Exception:
            state.reachable = False

    async def _poll_all(self) -> None:
        await asyncio.gather(
            *(self._poll(s) for s in self._plugs.values()),
            return_exceptions=True,
        )
        for s in self._plugs.values():
            log.info(
                "DeviceController: '%s' @ %s — %s",
                s.label, s.ip,
                ("ON" if s.is_on else "OFF") if s.reachable else "OFFLINE",
            )


async def _broadcast_device_state(state: PlugState) -> None:
    from datetime import datetime, timezone
    from convict.engines.experience.ws_broadcaster import broadcaster
    try:
        await broadcaster.broadcast({
            "type":      "device_state",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "seq":       0,
            "payload": {
                "label":    state.label,
                "ip":       state.ip,
                "is_on":    state.is_on,
                "reachable": state.reachable,
            },
        })
    except Exception:
        pass


# Module-level singleton
from convict.config import settings as _settings
controller = DeviceController(_settings)
