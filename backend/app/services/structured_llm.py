"""Instructor-backed structured generation for the local llama.cpp provider.

Wraps the OpenAI-compatible client with Instructor so that schema validation
failures (bad JSON, missing fields, out-of-range values) are fed back to the
model as part of an automatic re-ask, instead of the single blind retry the
agents previously did by hand. Callers should treat any failure here as
"structured generation unavailable" and fall back to the legacy
clean-json-then-parse path — this module never assumes it is the only way
to get a response.
"""

from __future__ import annotations

import logging
from typing import TypeVar

import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_client: instructor.AsyncInstructor | None = None


def _get_client() -> instructor.AsyncInstructor:
    """Lazily build the Instructor-patched async client.

    Mode.MD_JSON (extract JSON from a markdown-ish completion, no reliance on
    `response_format` or tool-calling support) is used because the local GGUF
    models this project targets (Qwen2.5 1.5B, Llama-3.2-1B, DeepSeek-R1
    Distill) don't reliably support function calling or json_object mode.
    """
    global _client
    if _client is None:
        raw = AsyncOpenAI(
            base_url=settings.LLAMA_CPP_BASE_URL.rstrip("/"),
            api_key="local",
        )
        _client = instructor.from_openai(raw, mode=instructor.Mode.MD_JSON)
    return _client


async def generate_structured(
    response_model: type[T],
    system: str,
    user: str,
    max_tokens: int | None = None,
    max_retries: int = 2,
) -> T:
    """Generate a validated `response_model` instance from the local LLM.

    Raises whatever Instructor/the underlying client raises on final failure
    (e.g. `instructor.exceptions.InstructorRetryException`) — callers are
    expected to catch and fall back, not to handle specific exception types
    here.
    """
    client = _get_client()
    return await client.chat.completions.create(
        model=settings.LLAMA_CPP_MODEL,
        response_model=response_model,
        max_retries=max_retries,
        max_tokens=max_tokens or 512,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
