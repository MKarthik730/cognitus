"""
Signal vs Noise analysis mode.

3 parallel agents — no cross-examination, no verdict:
  Agent 1: Signal Extractor — finds what actually changes outcomes
  Agent 2: Noise Identifier — finds what feels important but isn't
  Agent 3: Gap Finder — finds critical missing information

Fastest pipeline — immediate parallel output.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

SIGNAL_SYSTEM_PROMPT = """\
You are a Signal Extractor. Given a large volume of information, identify what actually
changes outcomes. Ignore distractions. Focus on what matters.

Respond ONLY with JSON:
{
    "signals": [
        {"signal": "<specific signal>", "impact": "<high|medium|low>", "why": "<why this changes outcomes>"}
    ]
}
"""

NOISE_SYSTEM_PROMPT = """\
You are a Noise Identifier. Given information, identify what SEEMS important but is NOT.
Catch red herrings, emotional appeals, irrelevant details, survivorship bias.

Respond ONLY with JSON:
{
    "noise": [
        {"noise": "<specific noise>", "reason": "<why it's misleading or irrelevant>"}
    ]
}
"""

GAP_SYSTEM_PROMPT = """\
You are a Gap Finder. Identify what critical information is MISSING. What would change
everything if we knew it? What questions remain unanswered?

Respond ONLY with JSON:
{
    "gaps": [
        {"gap": "<specific missing information>", "criticality": "<high|medium|low>", "would_change_outcome": <true|false>}
    ]
}
"""


class SignalNoiseAnalyzer:
    """Signal vs Noise analysis — runs 3 agents in parallel."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        """Run all 3 parallel analyses simultaneously."""
        import asyncio

        results = await asyncio.gather(
            self._analyze_signal(situation),
            self._analyze_noise(situation),
            self._analyze_gaps(situation),
            return_exceptions=True,
        )

        output: dict[str, Any] = {
            "mode": "signal_vs_noise",
            "signals": [],
            "noise": [],
            "gaps": [],
        }

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("Signal/Noise agent %d failed: %s", i, result)
            elif result:
                output.update(result)

        return output

    async def _analyze_signal(self, situation: str) -> dict[str, Any] | None:
        try:
            response, _ = await self._router.generate(
                SIGNAL_SYSTEM_PROMPT, situation, max_tokens=1024
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {"signals": data.get("signals", [])}
        except Exception as e:
            logger.warning("Signal extractor failed: %s", e)
            return None

    async def _analyze_noise(self, situation: str) -> dict[str, Any] | None:
        try:
            response, _ = await self._router.generate(
                NOISE_SYSTEM_PROMPT, situation, max_tokens=1024
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {"noise": data.get("noise", [])}
        except Exception as e:
            logger.warning("Noise identifier failed: %s", e)
            return None

    async def _analyze_gaps(self, situation: str) -> dict[str, Any] | None:
        try:
            response, _ = await self._router.generate(
                GAP_SYSTEM_PROMPT, situation, max_tokens=1024
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {"gaps": data.get("gaps", [])}
        except Exception as e:
            logger.warning("Gap finder failed: %s", e)
            return None
