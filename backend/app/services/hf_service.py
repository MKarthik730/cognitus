"""
HFService — Legacy wrapper around the new LLM router.

Maintains the same interface for backward compatibility.
All actual LLM calls are delegated to the LLMRouter's provider.
"""

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

from app.core.config import settings
from app.services.llm_router import get_llm_router, LLMRouter

logger = logging.getLogger(__name__)

ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"

_RETRY_EXCEPTIONS = (
    httpx.TimeoutException,
    httpx.RequestError,
)


class HFService:
    """Legacy HFService wrapper.

    Delegates to the LLM router for generation. Falls back to direct
    HuggingFace Router API calls for image analysis (not yet supported
    by all providers).
    """

    def __init__(self, router: LLMRouter | None = None) -> None:
        self._router = router or get_llm_router()
        self._models = [
            settings.HF_PRIMARY_MODEL,
            settings.HF_FALLBACK_1,
            settings.HF_FALLBACK_2,
        ]

    # ------------------------------------------------------------------
    # Router-based generation (primary)
    # ------------------------------------------------------------------

    async def generate(
        self,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> tuple[str, str]:
        """Generate via the LLM router. Falls back to HuggingFace if router fails."""
        try:
            return await self._router.generate(system, user, max_tokens)
        except Exception as e:
            logger.warning("LLM router generation failed, falling back to HF: %s", e)
            return await self._hf_fallback(system, user, max_tokens)

    async def generate_with_image(
        self,
        system: str,
        user: str,
        image_data_uri: str,
        max_tokens: int | None = None,
    ) -> str:
        """Generate with image — tries router first, falls back to HF."""
        try:
            result = await self._router.generate_with_image(
                system, user, image_data_uri, max_tokens
            )
            return result
        except NotImplementedError:
            pass  # Router doesn't support images, fall through
        except Exception as e:
            logger.warning("Router image generation failed, falling back to HF: %s", e)

        # Fall back to direct HuggingFace API for images
        return await self._hf_image_fallback(system, user, image_data_uri, max_tokens)

    async def summarize_text(
        self, text: str, filename: str = "document", max_length: int = 6000
    ) -> str:
        """Summarize via the LLM router."""
        try:
            return await self._router.summarize_text(text, filename, max_length)
        except Exception as e:
            logger.warning("Router summarization failed, using HF: %s", e)
            return await self._hf_summarize_fallback(text, filename, max_length)

    # ------------------------------------------------------------------
    # HuggingFace Router fallbacks
    # ------------------------------------------------------------------

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

    @retry(
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=2, min=2, max=8),
        retry=retry_if_exception_type(_RETRY_EXCEPTIONS),
    )
    async def _chat_with_image(
        self, model: str, system: str, user: str, image_data_uri: str, max_tokens: int
    ) -> str:
        headers = {
            "Authorization": f"Bearer {settings.HF_API_TOKEN}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": f"{model}:fastest",
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user},
                        {"type": "image_url", "image_url": {"url": image_data_uri}},
                    ],
                },
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

    async def _hf_fallback(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        """Fallback: direct HuggingFace Inference API."""
        max_tokens = max_tokens or settings.HF_DEFAULT_MAX_TOKENS
        last_error: Optional[Exception] = None
        for model in self._models:
            try:
                text = await self._chat(model, system, user, max_tokens)
                return text.strip(), model
            except Exception as e:
                logger.warning("HF model %s failed: %s", model, e)
                last_error = e
        raise RuntimeError("All HuggingFace models failed") from last_error

    async def _hf_image_fallback(
        self, system: str, user: str, image_data_uri: str, max_tokens: int | None = None
    ) -> str:
        max_tokens = max_tokens or settings.HF_DEFAULT_MAX_TOKENS
        last_error: Optional[Exception] = None
        for model in self._models:
            try:
                text = await self._chat_with_image(
                    model, system, user, image_data_uri, max_tokens
                )
                return text.strip()
            except Exception as e:
                logger.warning("HF model %s failed for image: %s", model, e)
                last_error = e
        raise RuntimeError("All models failed for image analysis") from last_error

    async def _hf_summarize_fallback(
        self, text: str, filename: str = "document", max_length: int = 6000
    ) -> str:
        if len(text) <= max_length:
            return text
        system = (
            "You are a precise document analyst. Summarize this document preserving "
            "all factual details, data points, names, numbers, and key arguments. "
            "Maintain the original meaning and avoid adding interpretations."
        )
        user = f"{filename}: {text}"
        result, _ = await self._hf_fallback(system, user, max_tokens=1024)
        return result.strip()
