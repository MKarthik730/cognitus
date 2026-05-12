import asyncio
from typing import Optional

from huggingface_hub import InferenceClient
from huggingface_hub.utils import HfHubHTTPError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from backend.app.core.config import settings

MODEL_FORMATS: dict[str, str] = {
    "mistralai/Mistral-7B-Instruct-v0.3": "mistral",
    "HuggingFaceH4/zephyr-7b-beta": "zephyr",
    "microsoft/Phi-3-mini-4k-instruct": "phi3",
}


def _format_prompt(system: str, user: str, model_id: str) -> str:
    fmt = MODEL_FORMATS.get(model_id, "mistral")
    if fmt == "mistral":
        return f"[INST] {system}\n\n{user} [/INST]"
    if fmt == "zephyr":
        return f"<|system|>{system}</s>\n<|user|>{user}</s>\n<|assistant|>"
    return f"<|system|>{system}<|end|>\n<|user|>{user}<|end|>\n<|assistant|>"


class HFService:
    def __init__(self) -> None:
        self._client = InferenceClient(token=settings.HF_API_TOKEN)
        self._models = [
            settings.HF_PRIMARY_MODEL,
            settings.HF_FALLBACK_1,
            settings.HF_FALLBACK_2,
        ]

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=8),
        retry=retry_if_exception_type((HfHubHTTPError, OSError)),
    )
    async def _infer(self, prompt: str, model: str) -> str:
        return await asyncio.to_thread(
            self._client.text_generation,
            prompt,
            model=model,
            max_new_tokens=settings.HF_MAX_NEW_TOKENS,
            temperature=0.3,
        )

    async def generate(self, system: str, user: str) -> tuple[str, str]:
        last_error: Optional[Exception] = None
        for model in self._models:
            prompt = _format_prompt(system, user, model)
            try:
                text = await self._infer(prompt, model)
                return text.strip(), model
            except Exception as e:
                last_error = e
        raise RuntimeError("All HuggingFace models failed") from last_error
