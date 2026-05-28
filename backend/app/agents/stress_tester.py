"""
Verdict Stress Test — post-analysis adversarial testing.

Auto-generates 5 adversarial scenarios: "What if [assumption] is wrong?"
Lightweight analysis on each scenario.
Shows which verdict parts survive and which collapse.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

STRESS_TEST_SYSTEM_PROMPT = """\
You are a verdict stress tester. Given a situation and its verdict, generate adversarial
scenarios that test the verdict's robustness. For each scenario, evaluate which parts of
the verdict survive and which collapse.

Respond ONLY with JSON:
{
    "scenarios": [
        {
            "scenario": "<adversarial 'what if' scenario>",
            "challenges": "<what assumption this challenges>",
            "survives": ["<part of verdict that holds>"],
            "collapses": ["<part of verdict that fails>"],
            "confidence_adjustment": "<increase|decrease|unchanged>"
        }
    ],
    "overall_robustness": "<high|medium|low>",
    "weakest_point": "<the verdict element most vulnerable to failure>"
}
"""


class StressTester:
    """Stress-tests a verdict with adversarial scenarios."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str, verdict: str, reasoning: str) -> dict[str, Any]:
        user_prompt = (
            f"SITUATION: {situation}\n\n"
            f"VERDICT: {verdict}\n\n"
            f"REASONING: {reasoning}\n\n"
            f"Generate adversarial scenarios that test this verdict."
        )
        try:
            response, _ = await self._router.generate(
                STRESS_TEST_SYSTEM_PROMPT, user_prompt, max_tokens=2048
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {
                "mode": "stress_test",
                "scenarios": data.get("scenarios", []),
                "overall_robustness": data.get("overall_robustness", "medium"),
                "weakest_point": data.get("weakest_point", ""),
                "scenario_count": len(data.get("scenarios", [])),
            }
        except Exception as e:
            logger.warning("Stress test failed: %s", e)
            return {"mode": "stress_test", "scenarios": [], "error": str(e)}
