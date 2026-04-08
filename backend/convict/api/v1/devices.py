"""
Device control API — TP-Link Kasa smart plugs.

Endpoints:
  GET  /devices          — list all configured plugs and their current state
  POST /devices/{label}/on     — turn on a plug by label
  POST /devices/{label}/off    — turn off a plug by label
  POST /devices/{label}/toggle — toggle a plug
"""
from fastapi import APIRouter, HTTPException
from convict.engines.control.device_controller import controller

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("")
async def list_devices():
    """Return current state of all configured smart plugs."""
    return {"devices": controller.get_state(), "ready": controller.is_ready()}


@router.post("/{label}/on")
async def device_on(label: str):
    result = await controller.turn_on(label)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "command failed"))
    return result


@router.post("/{label}/off")
async def device_off(label: str):
    result = await controller.turn_off(label)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "command failed"))
    return result


@router.post("/{label}/toggle")
async def device_toggle(label: str):
    result = await controller.toggle(label)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "command failed"))
    return result
