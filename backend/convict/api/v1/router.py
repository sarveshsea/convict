from fastapi import APIRouter
from convict.api.v1 import tank, fish, zones, schedules, stream, observations, tank_config, auth, intelligence, devices, health, insights

router = APIRouter(prefix="/api/v1")

router.include_router(auth.router)
router.include_router(tank.router)
router.include_router(fish.router)
router.include_router(zones.router)
router.include_router(schedules.router)
router.include_router(stream.router)
router.include_router(observations.router)
router.include_router(tank_config.router)
router.include_router(intelligence.router)
router.include_router(devices.router)
router.include_router(health.router)
router.include_router(insights.router)
