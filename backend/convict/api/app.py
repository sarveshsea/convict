import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from convict.config import settings
from convict.database import init_db
from convict.api.v1.router import router as v1_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
# Keep log volume configurable for lower-power machines.
logging.getLogger("convict").setLevel(getattr(logging, settings.log_level, logging.INFO))

log = logging.getLogger("convict.startup")


def _ensure_admin_password() -> None:
    """
    Auth policy:
      - admin_password set         → use it
      - empty + DEV_MODE=1         → log a warning, allow no-auth (explicit opt-in)
      - empty + DEV_MODE unset     → generate a one-shot password, print it loudly
    Prevents the silent "no auth" failure mode where a missing .env.local
    leaves the API open without anyone realizing.
    """
    if settings.admin_password:
        return
    if settings.dev_mode:
        log.warning("DEV_MODE=1 — running with NO authentication. Do not expose this server to the network.")
        return
    generated = secrets.token_urlsafe(12)
    settings.admin_password = generated
    banner = "=" * 60
    log.warning(banner)
    log.warning("ADMIN_PASSWORD not set — generated a one-shot password:")
    log.warning("    %s", generated)
    log.warning("Add ADMIN_PASSWORD=... to backend/.env.local to make it permanent,")
    log.warning("or set DEV_MODE=1 to disable auth entirely.")
    log.warning(banner)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _ensure_admin_password()
    await init_db()
    from convict.pipeline.db_writer import db_writer
    from convict.pipeline.orchestrator import orchestrator
    from convict.pipeline.retention import retention_loop
    await orchestrator.start()
    await db_writer.start()
    retention_task = asyncio.create_task(retention_loop(), name="retention")
    from convict.engines.control.device_controller import controller as device_controller
    await device_controller.initialize()
    yield
    # Shutdown
    retention_task.cancel()
    try:
        await retention_task
    except (asyncio.CancelledError, Exception):
        pass
    await db_writer.stop()
    await orchestrator.stop()
    from convict.engines.control.device_controller import controller as device_controller
    await device_controller.shutdown()
    # Cleanly terminate ffmpeg HLS processes (no-op if ffmpeg was never started)
    try:
        from convict.engines.observation.hls_streamer import hls_streamer, hls_streamer2
        hls_streamer.stop()
        hls_streamer2.stop()
    except Exception:
        log.exception("HLS streamer shutdown failed")


app = FastAPI(
    title="Convict",
    description="Aquarium intelligence platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
