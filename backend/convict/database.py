from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from convict.config import settings


engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from convict.models import __all_models__  # noqa: F401 — registers models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migrations for columns added after initial schema
        for ddl in [
            "ALTER TABLE known_fish ADD COLUMN auto_detected BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE known_fish ADD COLUMN species_guess_confidence REAL NOT NULL DEFAULT 0.0",
            "ALTER TABLE known_fish ADD COLUMN snapshot_jpeg BLOB",
            "ALTER TABLE tanks ADD COLUMN width_cm REAL",
            "ALTER TABLE tanks ADD COLUMN height_cm REAL",
            "ALTER TABLE tanks ADD COLUMN depth_cm REAL",
        ]:
            try:
                await conn.execute(text(ddl))
            except Exception:
                pass  # column already exists
