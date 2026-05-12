import time
from typing import Optional

from redis.asyncio import Redis

from backend.app.core.config import settings


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
