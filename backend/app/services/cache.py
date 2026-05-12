import hashlib
from typing import Optional

from redis.asyncio import Redis

CACHE_TTL = 86400


class CacheService:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    @staticmethod
    def _make_key(model: str, prompt: str) -> str:
        raw = f"{model}:{prompt}".encode()
        return f"cache:{hashlib.sha256(raw).hexdigest()}"

    async def get(self, model: str, prompt: str) -> Optional[str]:
        data = await self.redis.get(self._make_key(model, prompt))
        return data.decode() if data is not None else None

    async def set(self, model: str, prompt: str, response: str) -> None:
        await self.redis.setex(self._make_key(model, prompt), CACHE_TTL, response)
