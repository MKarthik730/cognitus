"""
Reverse Engineering mode.

User describes outcome that already happened. Council works backwards to find
the real cause chain — surface cause, real cause, root cause, prevention.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

REVERSE_SYSTEM_PROMPT = """\
You are a reverse engineer. Given an outcome that has already happened, work BACKWARDS
to find the real cause chain. Most people stop at the surface cause. You go deeper.

Respond ONLY with JSON:
{
    "surface_cause": {
        "cause": "<what everyone blames>",
        "why_obvious": "<why people point here first>",
        "likely_wrong": "<why this might be incomplete or misleading>"
    },
    "real_cause": {
        "cause": "<what actually drove the outcome>",
        "evidence": "<evidence supporting this>"
    },
    "root_cause": {
        "cause": "<what nobody is talking about>",
        "why_hidden": "<why it's invisible to most observers>"
    },
    "prevention": {
        "what_changes_outcome": "<specific change that prevents recurrence>",
        "who_must_act": "<who needs to act>"
    },
    "confidence": "<how confident in this analysis: high|medium|low>"
}
"""


class ReverseEngineer:
    """Reverse Engineering — works backwards from outcome to root cause."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        try:
            response, _ = await self._router.generate(
                REVERSE_SYSTEM_PROMPT, situation, max_tokens=2048
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {
                "mode": "reverse_engineer",
                "surface_cause": data.get("surface_cause", {}),
                "real_cause": data.get("real_cause", {}),
                "root_cause": data.get("root_cause", {}),
                "prevention": data.get("prevention", {}),
                "confidence": data.get("confidence", "medium"),
            }
        except Exception as e:
            logger.warning("Reverse engineering failed: %s", e)
            return {"mode": "reverse_engineer", "error": str(e)}
