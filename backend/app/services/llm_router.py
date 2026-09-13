"""
LLM Router for a local llama.cpp OpenAI-compatible server.

The application uses the llama.cpp server at LLAMA_CPP_BASE_URL and sends
requests for the configured GGUF model.

The router provides the same interface as the legacy HFService:
    generate(system, user, max_tokens) → (response_text, model_name)
    generate_with_image(...)           → response_text
    summarize_text(...)                → summarized_text

All providers validate against Pydantic schemas downstream; hallucination
detection runs on all modes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import re
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, AsyncGenerator, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class LLMMode(str, Enum):
    LOCAL = "local"


# ---------------------------------------------------------------------------
# Hardware info
# ---------------------------------------------------------------------------

class HardwareInfo:
    """Detected hardware capabilities for Local/Ollama mode model recommendations."""

    def __init__(self) -> None:
        self.ram_gb: float = 0.0
        self.vram_gb: float = 0.0
        self.has_nvidia_gpu: bool = False
        self.has_amd_gpu: bool = False
        self.has_apple_silicon: bool = False
        self.recommended_model: str = "llama3.1:8b-q4_K_M"
        self.accuracy: float = 0.82
        self._detected: bool = False

    def detect(self) -> HardwareInfo:
        """Run hardware detection once and cache results."""
        if self._detected:
            return self
        self._detected = True

        # RAM
        try:
            import psutil
            self.ram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
        except ImportError:
            logger.warning("psutil not available, RAM detection skipped")
            self.ram_gb = 8.0

        # Apple Silicon
        if platform.processor() and ("arm" in platform.processor().lower()):
            import sys
            if sys.platform == "darwin":
                self.has_apple_silicon = True
                # Apple Silicon shares RAM between CPU/GPU
                self.vram_gb = self.ram_gb

        # NVIDIA GPU
        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                self.has_nvidia_gpu = True
                vrams = [int(x.strip()) for x in result.stdout.strip().split("\n") if x.strip().isdigit()]
                if vrams:
                    self.vram_gb = round(max(vrams) / 1024, 1)
        except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
            pass

        # AMD GPU via ROCm
        try:
            import subprocess
            result = subprocess.run(
                ["rocm-smi", "--showmeminfo", "vram"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                self.has_amd_gpu = True
                # Parse VRAM from rocm-smi output
                match = re.search(r"(\d+)\s*MB", result.stdout)
                if match:
                    self.vram_gb = round(int(match.group(1)) / 1024, 1)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # Determine recommended model
        rec = self._recommend()
        self.recommended_model = rec["model"]
        self.accuracy = rec["accuracy"]

        logger.info(
            "Hardware detected: RAM=%sGB VRAM=%sGB NVIDIA=%s AMD=%s AppleSilicon=%s → %s (%.0f%%)",
            self.ram_gb, self.vram_gb, self.has_nvidia_gpu, self.has_amd_gpu,
            self.has_apple_silicon, self.recommended_model, self.accuracy * 100,
        )
        return self

    def _recommend(self) -> dict[str, Any]:
        """Recommend model based on available VRAM/RAM.

        Rankings (from spec):
          1. Qwen 2.5    — best JSON adherence
          2. Llama 3.1   — excellent
          3. Mistral     — good
          4. DeepSeek R1 — excellent but verbose
          5. Gemma 2     — occasionally breaks JSON
          6. Phi 3.5     — inconsistent on complex schemas

        DeepSeek R1 preferred when hardware allows.
        """
        vram = self.vram_gb
        ram = self.ram_gb

        # DeepSeek R1 variants (preferred when possible)
        if vram >= 20:
            return {"model": "deepseek-r1:70b", "accuracy": 0.96, "reason": "High VRAM — DeepSeek R1 70B"}
        if vram >= 16:
            return {"model": "llama3.1:70b-q4_K_M", "accuracy": 0.95, "reason": "16GB+ VRAM — Llama 3.1 70B quantized"}
        if vram >= 10:
            return {"model": "qwen2.5:14b-q6_K", "accuracy": 0.88, "reason": "10GB+ VRAM — Qwen 2.5 14B (best JSON)"}
        if vram >= 8:
            return {"model": "qwen2.5:14b-q4_K_M", "accuracy": 0.86, "reason": "8GB+ VRAM — Qwen 2.5 14B quantized"}
        if vram >= 6:
            return {"model": "llama3.1:8b-q4_K_M", "accuracy": 0.82, "reason": "6GB+ VRAM — Llama 3.1 8B"}
        if vram >= 4:
            return {"model": "mistral:7b-q4_K_M", "accuracy": 0.80, "reason": "4GB+ VRAM — Mistral 7B"}

        # Fall back to RAM-only estimates
        if ram >= 16:
            return {"model": "qwen2.5:14b-q4_K_M", "accuracy": 0.85, "reason": "16GB+ RAM — Qwen 2.5 14B"}
        if ram >= 8:
            return {"model": "llama3.1:8b-q4_K_M", "accuracy": 0.80, "reason": "8GB+ RAM — Llama 3.1 8B"}

        return {"model": "phi3.5:mini-instruct", "accuracy": 0.75, "reason": "Limited hardware — Phi 3.5 Mini"}


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """Abstract base for all LLM providers."""

    @abstractmethod
    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        """Generate a response. Returns (response_text, model_name)."""
        ...

    async def stream(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream a response token by token. Default yields the full response as one token."""
        result, _ = await self.generate(system, user, max_tokens)
        yield result

    async def generate_with_image(
        self, system: str, user: str, image_data_uri: str, max_tokens: int | None = None
    ) -> str:
        """Generate a response with an image input. Default raises NotImplementedError."""
        raise NotImplementedError(f"{type(self).__name__} does not support image inputs")

    async def summarize_text(
        self, text: str, filename: str = "document", max_length: int = 6000
    ) -> str:
        """Summarize a long text. Default implementation calls generate()."""
        if len(text) <= max_length:
            return text
        system = (
            "You are a precise document analyst. Summarize this document preserving "
            "all factual details, data points, names, numbers, and key arguments. "
            "Maintain the original meaning and avoid adding interpretations."
        )
        user = f"{filename}: {text}"
        result, _ = await self.generate(system, user, max_tokens=1024)
        return result.strip()


# ---------------------------------------------------------------------------
# Provider: Free (Groq)
# ---------------------------------------------------------------------------

class GroqProvider(LLMProvider):
    """Free tier via Groq API using LangChain ChatGroq.

    Primary:  llama-3.3-70b-versatile
    Fallback: gemini-flash-1.5 via Google AI Studio (if configured)

    Accepts an optional api_key to override env/settings-based key.
    """

    PRIMARY_MODEL = "llama-3.3-70b-versatile"
    FALLBACK_MODEL = "gemini-flash-1.5"

    def __init__(self, api_key: str | None = None) -> None:
        self._client: Any = None
        self._fallback_client: Any = None
        self._override_api_key = api_key
        self._init_clients()

    def _init_clients(self) -> None:
        try:
            from langchain_groq import ChatGroq
            # Use override key first, then settings, then env var
            api_key = self._override_api_key or settings.GROQ_API_KEY or os.environ.get("GROQ_API_KEY")
            if not api_key:
                raise ValueError("GROQ_API_KEY not configured")
            logger.info("Initializing Groq client with key length: %d", len(api_key))
            self._client = ChatGroq(
                model=self.PRIMARY_MODEL,
                api_key=api_key,
                temperature=0.3,
            )
        except Exception as e:
            logger.warning("Failed to init Groq client: %s", e)
            self._client = None

        self._fallback_client = None

    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        max_tokens = max_tokens or 512
        kwargs = {"max_tokens": max_tokens}

        # Try primary
        if self._client:
            try:
                messages = [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]
                response = await self._client.ainvoke(messages, **kwargs)
                return response.content.strip(), self.PRIMARY_MODEL
            except Exception as e:
                logger.warning("Groq primary failed: %s", e)

        # Try fallback
        if self._fallback_client:
            try:
                messages = [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]
                response = await self._fallback_client.ainvoke(messages, **kwargs)
                return response.content.strip(), self.FALLBACK_MODEL
            except Exception as e:
                logger.warning("Groq fallback failed: %s", e)

        raise RuntimeError("All Groq providers failed")


# ---------------------------------------------------------------------------
# Provider: Local llama.cpp
# ---------------------------------------------------------------------------

class LlamaCppProvider(LLMProvider):
    """Inference through any OpenAI-compatible /v1/chat/completions endpoint.

    Despite the name, this isn't limited to a local llama.cpp server — the
    base_url/model/api_key are all overridable per-request, so this same
    provider talks to a local server, a tunneled endpoint (ngrok/cloudflared
    fronting a Kaggle-hosted model), or any other OpenAI-compatible host.
    Falls back to the configured local defaults when no override is given.
    """

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (base_url or settings.LLAMA_CPP_BASE_URL).rstrip("/")
        self.model = model or settings.LLAMA_CPP_MODEL
        self._api_key = api_key or "not-needed"
        self._client: Any = None
        self._init_client()

    def _init_client(self) -> None:
        try:
            from langchain_openai import ChatOpenAI
            self._client = ChatOpenAI(
                model=self.model,
                base_url=self.base_url,
                api_key=self._api_key,
                temperature=0.3,
            )
        except Exception as e:
            logger.error("Failed to init LLM client for %s: %s", self.base_url, e)
            self._client = None

    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        if not self._client:
            raise RuntimeError(f"LLM client not initialized for endpoint {self.base_url}")

        max_tokens = max_tokens or 512
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        try:
            response = await self._client.ainvoke(
                messages,
                max_tokens=max_tokens,
            )
            return response.content.strip(), self.model
        except Exception as e:
            logger.error("llama.cpp generate failed: %s", e)
            raise


# ---------------------------------------------------------------------------
# Provider: Paid (BYOK)
# ---------------------------------------------------------------------------

class PaidProvider_(LLMProvider):
    """Bring-your-own-key provider.

    Supports OpenAI (ChatOpenAI) and Anthropic (ChatAnthropic).
    Provider is selected via PAID_PROVIDER env var.
    Keys are stored in .env only, never on server.
    """

    def __init__(self, provider: str | None = None) -> None:
        self.provider = (provider or settings.PAID_PROVIDER or "openai").lower()
        self._client: Any = None
        self._model: str = ""
        self._init_client()

    def _init_client(self) -> None:
        if self.provider == PaidProvider.ANTHROPIC:
            self._init_anthropic()
        else:
            self._init_openai()

    def _init_openai(self) -> None:
        try:
            from langchain_openai import ChatOpenAI
            api_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY not configured")
            self._model = settings.OPENAI_MODEL or "gpt-4o"
            self._client = ChatOpenAI(
                model=self._model,
                api_key=api_key,
                temperature=0.3,
            )
        except Exception as e:
            logger.error("Failed to init OpenAI client: %s", e)
            self._client = None

    def _init_anthropic(self) -> None:
        try:
            from langchain_anthropic import ChatAnthropic
            api_key = settings.ANTHROPIC_API_KEY or os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not configured")
            self._model = settings.ANTHROPIC_MODEL or "claude-3-5-sonnet-20241022"
            self._client = ChatAnthropic(
                model=self._model,
                api_key=api_key,
                temperature=0.3,
            )
        except Exception as e:
            logger.error("Failed to init Anthropic client: %s", e)
            self._client = None

    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        if not self._client:
            raise RuntimeError(f"Paid provider '{self.provider}' not initialized. Check API key.")

        max_tokens = max_tokens or 512
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        try:
            kwargs = {"max_tokens": max_tokens}
            response = await self._client.ainvoke(messages, **kwargs)
            return response.content.strip(), f"{self.provider}:{self._model}"
        except Exception as e:
            logger.error("Paid provider generate failed: %s", e)
            raise


# ---------------------------------------------------------------------------
# Provider: Browser (WebLLM stub)
# ---------------------------------------------------------------------------

class BrowserProvider(LLMProvider):
    """Browser/WebLLM provider.

    This is a stub for the backend. Actual inference happens in the browser
    via @mlc-ai/web-llm running on WebGPU. The backend is never involved
    in LLM calls in browser mode.

    If this provider is instantiated, it means something is wrong — the
    frontend should handle all LLM calls in browser mode.
    """

    def __init__(self) -> None:
        logger.warning(
            "BrowserProvider instantiated on backend — WebLLM should run in browser only. "
            "Falling back to Free mode."
        )

    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        raise RuntimeError(
            "Browser/WebLLM runs in the frontend only. "
            "Backend should not be handling LLM calls in browser mode."
        )


# ---------------------------------------------------------------------------
# Main Router
# ---------------------------------------------------------------------------

class LLMRouter:
    """4-mode LLM router.

    Usage:
        router = LLMRouter()
        text, model = await router.generate("system", "user")
        text = await router.generate_with_image("system", "user", image_uri)
        text = await router.summarize_text(long_text)

    Accepts optional overrides for the endpoint (base_url), model name, and
    api_key — so the same router can point at a local llama.cpp server, a
    tunneled endpoint (e.g. ngrok/cloudflared fronting a Kaggle-hosted model),
    or any other OpenAI-compatible host, without redeploying.
    """

    def __init__(
        self,
        mode: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self.mode = LLMMode.LOCAL
        self._provider: LLMProvider | None = None
        self._hardware: HardwareInfo | None = None
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._init_provider()

    def _init_provider(self) -> None:
        self._provider = LlamaCppProvider(
            base_url=self._base_url, model=self._model, api_key=self._api_key,
        )

    def _detect_hardware(self) -> HardwareInfo:
        if self._hardware is None:
            self._hardware = HardwareInfo().detect()
        return self._hardware

    # ------------------------------------------------------------------
    # Public API — matches HFService interface for drop-in replacement
    # ------------------------------------------------------------------

    async def generate(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> tuple[str, str]:
        if not self._provider:
            raise RuntimeError(f"No provider available for mode {self.mode}")
        return await self._provider.generate(system, user, max_tokens)

    async def generate_with_image(
        self, system: str, user: str, image_data_uri: str, max_tokens: int | None = None
    ) -> str:
        if not self._provider:
            raise RuntimeError(f"No provider available for mode {self.mode}")
        return await self._provider.generate_with_image(system, user, image_data_uri, max_tokens)

    async def stream(
        self, system: str, user: str, max_tokens: int | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream a response token by token from the active provider."""
        if not self._provider:
            raise RuntimeError(f"No provider available for mode {self.mode}")
        async for token in self._provider.stream(system, user, max_tokens):
            yield token

    async def summarize_text(
        self, text: str, filename: str = "document", max_length: int = 6000
    ) -> str:
        if not self._provider:
            raise RuntimeError(f"No provider available for mode {self.mode}")
        return await self._provider.summarize_text(text, filename, max_length)

    # ------------------------------------------------------------------
    # Utility methods
    # ------------------------------------------------------------------

    def get_mode(self) -> str:
        return self.mode.value

    def get_model_name(self) -> str:
        """Return the active model name string."""
        if isinstance(self._provider, LlamaCppProvider):
            return self._provider.model
        return "unknown"

    # ------------------------------------------------------------------
    # R1 Thinking Parser
    # ------------------------------------------------------------------

    def parse_r1_thinking(self, raw_response: str) -> tuple[list[dict[str, str]], str]:
        """Parse DeepSeek R1 <think> tags from a raw response.

        R1 models output their reasoning inside <think>...</think> tags.
        This method extracts those thinking steps and returns them alongside
        the clean response (with tags removed).

        Returns:
            (thinking_steps, clean_response)
            - thinking_steps: list of {"step": "...", "content": "..."}
            - clean_response: response with <think> tags removed
        """
        thinking_steps: list[dict[str, str]] = []
        clean = raw_response

        # Extract all <think> blocks
        pattern = re.compile(r'<think>(.*?)</think>', re.DOTALL)
        matches = list(pattern.finditer(raw_response))

        if not matches:
            # Try single tag without closing
            single_pattern = re.compile(r'<think>(.*)', re.DOTALL)
            single_match = single_pattern.search(raw_response)
            if single_match:
                content = single_match.group(1).strip()
                if content:
                    thinking_steps.append({
                        "step": "reasoning",
                        "content": content[:2000],  # Limit length
                    })
                clean = single_pattern.sub('', raw_response).strip()
            return thinking_steps, clean

        for i, match in enumerate(matches):
            content = match.group(1).strip()
            if content:
                thinking_steps.append({
                    "step": f"reasoning_step_{i + 1}",
                    "content": content[:2000],
                })

        # Remove all <think> tags
        clean = pattern.sub('', raw_response).strip()

        return thinking_steps, clean

    def is_r1_model(self) -> bool:
        """Check if the active model is a DeepSeek R1 variant."""
        model = self.get_model_name().lower()
        return "deepseek" in model or "r1" in model

    def validate_config(self) -> list[str]:
        """Validate the current configuration. Returns list of error messages (empty = OK)."""
        errors: list[str] = []

        if self.mode == LLMMode.LOCAL:
            import httpx
            try:
                base_url = settings.LLAMA_CPP_BASE_URL.rstrip("/")
                r = httpx.get(f"{base_url}/models", timeout=3)
                if r.status_code != 200:
                    errors.append(f"llama.cpp not responding at {base_url}")
            except Exception:
                errors.append(f"llama.cpp not reachable at {base_url}")

        return errors

    def detect_hardware(self) -> dict[str, Any]:
        """Run hardware detection and return results."""
        hw = self._detect_hardware()
        return {
            "ram_gb": hw.ram_gb,
            "vram_gb": hw.vram_gb,
            "has_nvidia_gpu": hw.has_nvidia_gpu,
            "has_amd_gpu": hw.has_amd_gpu,
            "has_apple_silicon": hw.has_apple_silicon,
            "recommended_model": hw.recommended_model,
            "accuracy": hw.accuracy,
        }

    def recommend_model(self) -> dict[str, Any]:
        """Get model recommendation based on hardware."""
        hw = self._detect_hardware()
        return {
            "model": hw.recommended_model,
            "accuracy": hw.accuracy,
            "ram_gb": hw.ram_gb,
            "vram_gb": hw.vram_gb,
        }


# ---------------------------------------------------------------------------
# Global singleton for application-wide use
# ---------------------------------------------------------------------------

_router_instance: LLMRouter | None = None


def get_llm_router() -> LLMRouter:
    """Get or create the global LLM router singleton."""
    global _router_instance
    if _router_instance is None:
        mode = os.environ.get("LLM_MODE") or settings.LLM_MODE
        _router_instance = LLMRouter(mode=mode)
    return _router_instance


def reset_llm_router(
    mode: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> LLMRouter:
    """Reset the router (e.g. when Ghost Mode or a custom endpoint is set).

    Args:
        mode: Optional LLM mode override.
        api_key: Optional API key override (e.g. for a cloud/tunneled endpoint
                 that requires auth, sent from the frontend per-request).
        base_url: Optional endpoint override — a local llama.cpp URL, a
                  tunneled endpoint (ngrok/cloudflared), or any other
                  OpenAI-compatible host.
        model: Optional model name override, matching what the target
               endpoint actually serves.
    """
    global _router_instance
    _router_instance = LLMRouter(
        mode=mode or settings.LLM_MODE,
        api_key=api_key,
        base_url=base_url,
        model=model,
    )
    return _router_instance
