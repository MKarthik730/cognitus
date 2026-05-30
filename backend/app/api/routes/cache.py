"""Cache management routes.

- DELETE /api/cache/{session_id} — Clear all cached results for a session
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from redis.asyncio import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cache", tags=["cache"])


async def get_redis() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)


@router.delete("/{session_id}")
async def clear_cache(session_id: str) -> dict[str, str]:
    """Clear all cached LLM results for a given session.

    Removes all Redis keys matching 'result:*' pattern.
    """
    try:
        redis = await get_redis()
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = await redis.scan(cursor=cursor, match="result:*", count=100)
            if keys:
                deleted += await redis.delete(*keys)
            if cursor == 0:
                break
        await redis.aclose()
        return {
            "status": "ok",
            "deleted": str(deleted),
            "message": f"Cleared {deleted} cached results",
        }
    except Exception as e:
        logger.error("Failed to clear cache: %s", e)
        raise HTTPException(status_code=500, detail=f"Cache clear failed: {str(e)}") from e
