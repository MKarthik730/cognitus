"""
Pre-Mortem analysis mode.

User describes a plan they're excited about. Pipeline assumes it already failed.
Each expert explains different failure reason. Synthesizer identifies single most likely
failure point.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

PRE_MORTEM_SYSTEM_PROMPT = """\
You are a pre-mortem analyst. The plan described has ALREADY FAILED. Your job is to
explain WHY it failed. Be specific, credible, and grounded in real-world dynamics.

Consider: market conditions, execution failures, human factors, timing, competition,
resource constraints, regulatory issues, technical debt.

Respond ONLY with JSON:
{
    "failure_scenarios": [
        {
            "scenario": "<specific failure scenario>",
            "probability": "<high|medium|low>",
            "signs": "<early warning signs to watch for>",
            "prevention": "<what would prevent this failure>"
        }
    ],
    "most_likely_failure": "<single most likely failure mode>",
    "critical_fix": "<one thing to fix before starting>",
    "confidence": "<X% of similar plans fail here>"
}
"""


class PreMortemAnalyzer:
    """Pre-Mortem analysis — assumes plan failed, finds why."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        try:
            response, _ = await self._router.generate(
                PRE_MORTEM_SYSTEM_PROMPT, situation, max_tokens=2048
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {
                "mode": "pre_mortem",
                "failure_scenarios": data.get("failure_scenarios", []),
                "most_likely_failure": data.get("most_likely_failure", ""),
                "critical_fix": data.get("critical_fix", ""),
                "confidence": data.get("confidence", ""),
                "scenario_count": len(data.get("failure_scenarios", [])),
            }
        except Exception as e:
            logger.warning("Pre-mortem analysis failed: %s", e)
            return {"mode": "pre_mortem", "failure_scenarios": [], "error": str(e)}
