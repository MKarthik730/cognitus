from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from backend.app.api.routes import auth, sessions, analyze
from backend.app.api.upload import router as upload_router
from backend.app.api.websocket import router as ws_router
from backend.app.core.config import settings
from backend.app.services.hf_service import HFService
from backend.app.services.queue_worker import QueueWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

redis: Redis | None = None
queue_worker: QueueWorker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global redis, queue_worker
    try:
        redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis.ping()
        hf_service = HFService()
        queue_worker = QueueWorker(redis, hf_service)
        worker_task = asyncio.create_task(queue_worker.start())
        logger.info("Queue worker started")
    except Exception as e:
        logger.warning("Redis unavailable, running without queue worker: %s", e)
        redis = None
        queue_worker = None
        worker_task = None

    yield

    if queue_worker is not None:
        await queue_worker.stop()
    if worker_task is not None:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
    if redis is not None:
        await redis.close()
    logger.info("Shutdown complete")


app = FastAPI(
    title="Cognitus",
    description="Multi-perspective AI reasoning platform powered by HuggingFace LLMs",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(analyze.router)
app.include_router(upload_router)
app.include_router(ws_router)


@app.get("/api/nodes")
async def list_domains():
    from backend.app.agents.expert_node import DOMAIN_PROMPTS

    return {
        "domains": [
            {"name": k, "description": v.split(".")[0].strip()}
            for k, v in DOMAIN_PROMPTS.items()
        ]
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
