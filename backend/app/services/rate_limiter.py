from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from typing import Optional

from redis.asyncio import Redis

from backend.app.core.config import settings

logger = logging.getLogger(__name__)


class InMemoryRateLimiter:
    """
    Fallback rate limiter used when Redis is unavailable.
    Uses token bucket per user_id stored in a dict.
    Not distributed — only works for single-process deployments.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._burst_timestamps: dict[str, list[float]] = defaultdict(list)
        self._hourly_counts: dict[str, int] = defaultdict(int)
        self._hourly_reset: dict[str, float] = {}
        self._daily_count: int = 0
        self._daily_reset: float = time.time() + 86400

    async def check(
        self, user_id: str, burst_limit: int, hourly_limit: int, daily_limit: int
    ) -> bool:
        """Returns True if request is allowed, False if rate limited."""
        now = time.time()
        async with self._lock:
            # Daily check
            if now > self._daily_reset:
                self._daily_count = 0
                self._daily_reset = now + 86400
            if self._daily_count >= daily_limit:
                return False

            # Hourly check per user
            if now > self._hourly_reset.get(user_id, 0):
                self._hourly_counts[user_id] = 0
                self._hourly_reset[user_id] = now + 3600
            if self._hourly_counts[user_id] >= hourly_limit:
                return False

            # Burst check per user (2-second window)
            self._burst_timestamps[user_id] = [
                t
                for t in self._burst_timestamps[user_id]
                if now - t < 2.0
            ]
            if len(self._burst_timestamps[user_id]) >= burst_limit:
                return False

            # All checks passed — consume
            self._daily_count += 1
            self._hourly_counts[user_id] += 1
            self._burst_timestamps[user_id].append(now)
            return True


# Singleton — module-level instance
_in_memory_limiter = InMemoryRateLimiter()
_in_memory_warning_issued = False


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def check_burst(self, user_id: int) -> bool:
        key = f"burst:{user_id}"
        now = time.time()
        await self.redis.zremrangebyscore(key, 0, now - 2)
        count = await self.redis.zcard(key)
        if count >= 1:
            return False
        await self.redis.zadd(key, {str(now): now})
        await self.redis.expire(key, 2)
        return True

    async def check_hourly(self, user_id: int) -> bool:
        key = f"hourly:{user_id}:{int(time.time() / 3600)}"
        raw = await self.redis.get(key)
        if raw is not None and int(raw) >= settings.HF_HOURLY_LIMIT:
            return False
        await self.redis.incr(key)
        await self.redis.expire(key, 3600)
        return True

    async def check_daily(self) -> bool:
        key = f"daily:{int(time.time() / 86400)}"
        raw = await self.redis.get(key)
        if raw is not None and int(raw) >= settings.HF_DAILY_LIMIT:
            return False
        await self.redis.incr(key)
        await self.redis.expire(key, 86400)
        return True

    async def check_all(self, user_id: int) -> tuple[bool, Optional[str]]:
        if not await self.check_burst(user_id):
            return False, "burst"
        if not await self.check_hourly(user_id):
            return False, "hourly"
        if not await self.check_daily():
            return False, "daily"
        return True, None

    async def reset_counters(self, user_id: int) -> None:
        await self.redis.delete(f"burst:{user_id}")
        await self.redis.delete(f"hourly:{user_id}:{int(time.time() / 3600)}")


async def check_rate_limit(
    redis: Redis | None, user_id: int
) -> tuple[bool, Optional[str]]:
    """Check rate limits, falling back to in-memory if Redis is unavailable."""
    global _in_memory_warning_issued  # noqa: PLW0603

    if redis is not None:
        limiter = RateLimiter(redis)
        return await limiter.check_all(user_id)

    # Redis unavailable — fall back to in-memory limiter
    if not _in_memory_warning_issued:
        logger.warning(
            "Redis unavailable — using in-memory rate limiter "
            "(single-process only, resets on restart)"
        )
        _in_memory_warning_issued = True

    allowed = await _in_memory_limiter.check(
        user_id=str(user_id),
        burst_limit=1,
        hourly_limit=settings.HF_HOURLY_LIMIT,
        daily_limit=settings.HF_DAILY_LIMIT,
    )
    return allowed, None if allowed else "daily"
