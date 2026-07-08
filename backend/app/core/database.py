from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database extensions (pgvector) and create all tables on startup."""
    # Try to enable the vector extension (optional — may not be installed)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Could not enable pgvector: %s", e)

    # Always create tables regardless of extension status
    try:
        from app.models import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Could not create database tables: %s", e)
