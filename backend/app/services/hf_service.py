from __future__ import annotations

import logging
from typing import Optional

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"

_RETRY_EXCEPTIONS = (
    httpx.TimeoutException,
    httpx.RequestError,
)


class HFService:
    def __init__(self) -> None:
        self._models = [
            settings.HF_PRIMARY_MODEL,
            settings.HF_FALLBACK_1,
            settings.HF_FALLBACK_2,
        ]

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=8),
        retry=retry_if_exception_type(_RETRY_EXCEPTIONS),
    )
    async def _chat(self, model: str, system: str, user: str, max_tokens: int) -> str:
        headers = {
            "Authorization": f"Bearer {settings.HF_API_TOKEN}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": f"{model}:fastest",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.HF_TIMEOUT)
        ) as client:
            response = await client.post(ROUTER_URL, headers=headers, json=payload)

            if response.status_code == 400:
                logger.error("HF API 400 on model %s: %s", model, response.text[:500])
                raise RuntimeError(f"Model {model} returned 400: {response.text[:200]}")

            if response.status_code == 429:
                logger.warning("HF API rate limited on model %s", model)
                raise RuntimeError(f"Rate limited on model {model}")

            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return content or ""

    async def generate(
        self,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> tuple[str, str]:
        max_tokens = max_tokens or settings.HF_DEFAULT_MAX_TOKENS
        last_error: Optional[Exception] = None
        for model in self._models:
            try:
                text = await self._chat(model, system, user, max_tokens)
                return text.strip(), model
            except Exception as e:
                logger.warning("Model %s failed: %s", model, e)
                last_error = e
        raise RuntimeError("All HuggingFace models failed") from last_error
