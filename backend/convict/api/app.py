from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from convict.config import settings
from convict.database import init_db
from convict.api.v1.router import router as v1_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    from convict.pipeline.orchestrator import orchestrator
    await orchestrator.start()
    yield
    # Shutdown
    await orchestrator.stop()


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
