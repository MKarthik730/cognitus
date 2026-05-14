from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from redis.asyncio import Redis

from backend.app.services.hf_service import HFService
from backend.app.graph.council_graph import CouncilGraph

logger = logging.getLogger(__name__)

QUEUE_KEY = "analysis_queue"
RESULT_KEY_PREFIX = "analysis_result:"
POLL_INTERVAL = 1.0


class QueueWorker:
    def __init__(self, redis: Redis, hf_service: HFService) -> None:
        self.redis = redis
        self.council_graph = CouncilGraph(hf_service)
        self._running = False

    async def enqueue(
        self, task_id: str, situation: str, session_id: str, user_id: int
    ) -> None:
        payload = json.dumps(
            {
                "task_id": task_id,
                "situation": situation,
                "session_id": session_id,
                "user_id": user_id,
            }
        )
        await self.redis.rpush(QUEUE_KEY, payload)

    async def start(self) -> None:
        self._running = True
        logger.info("Queue worker started")
        while self._running:
            try:
                raw = await self.redis.blpop(QUEUE_KEY, timeout=POLL_INTERVAL)
                if raw is None:
                    continue
                _, payload = raw
                await self._process(json.loads(payload))
            except Exception as e:
                logger.error("Queue worker error: %s", e)

    async def stop(self) -> None:
        self._running = False

    async def _process(self, task: dict[str, Any]) -> None:
        task_id = task["task_id"]
        try:
            result = await self.council_graph.run(
                situation=task["situation"],
                session_id=task["session_id"],
                user_id=task["user_id"],
            )
            await self.redis.setex(
                f"{RESULT_KEY_PREFIX}{task_id}",
                3600,
                json.dumps(result, default=str),
            )
            await self.redis.publish(f"result:{task_id}", "completed")
            logger.info("Task %s completed", task_id)
        except Exception as e:
            logger.error("Task %s failed: %s", task_id, e)
            await self.redis.setex(
                f"{RESULT_KEY_PREFIX}{task_id}",
                3600,
                json.dumps({"error": str(e)}),
            )
            await self.redis.publish(f"result:{task_id}", "failed")
