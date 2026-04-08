import logging
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    from convict.pipeline.orchestrator import orchestrator
    await orchestrator.start()
    yield
    # Shutdown
    await orchestrator.stop()
    # Cleanly terminate ffmpeg HLS processes (no-op if ffmpeg was never started)
    try:
        from convict.engines.observation.hls_streamer import hls_streamer, hls_streamer2
        hls_streamer.stop()
        hls_streamer2.stop()
    except Exception:
        pass


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
