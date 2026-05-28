"""
Debate mode — proposition analysis.

3 agents:
  Agent A: Steel-man FOR (strongest possible case)
  Agent B: Steel-man AGAINST (strongest possible case)
  Agent C: Neutral Arbitrator (evaluates both)
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

FOR_SYSTEM_PROMPT = """\
You are a debate champion arguing FOR the proposition. Build the STRONGEST possible case.
Use logic, evidence, and rhetoric. Do not hold back — your job is to make the best
argument FOR this position, even if you personally disagree.

Respond ONLY with JSON:
{
    "position": "for",
    "strongest_arguments": [
        {"argument": "<specific argument>", "support": "<evidence or logic>"}
    ],
    "rebuttal_against_opposition": "<preemptive rebuttal of expected counter-arguments>"
}
"""

AGAINST_SYSTEM_PROMPT = """\
You are a debate champion arguing AGAINST the proposition. Build the STRONGEST possible
case against it. Use logic, evidence, and rhetoric. Do not hold back — your job is to
make the best argument AGAINST this position, even if you personally disagree.

Respond ONLY with JSON:
{
    "position": "against",
    "strongest_arguments": [
        {"argument": "<specific argument>", "support": "<evidence or logic>"}
    ],
    "rebuttal_against_opposition": "<preemptive rebuttal of expected counter-arguments>"
}
"""

ARBITRATOR_SYSTEM_PROMPT = """\
You are a neutral arbitrator. Evaluate both sides of a debate objectively.
Determine which argument is stronger and why. Be specific about what evidence
would change the verdict.

Respond ONLY with JSON:
{
    "for_summary": "<summary of the FOR position>",
    "against_summary": "<summary of the AGAINST position>",
    "stronger_argument": "<for|against|tie>",
    "reasoning": "<detailed reasoning for which is stronger>",
    "what_would_change_verdict": "<what evidence would change the outcome>"
}
"""


class DebateAnalyzer:
    """Debate analysis — steel-man both sides + arbitrator."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        import asyncio

        results = await asyncio.gather(
            self._run_agent(FOR_SYSTEM_PROMPT, situation),
            self._run_agent(AGAINST_SYSTEM_PROMPT, situation),
            return_exceptions=True,
        )

        for_side = results[0] if not isinstance(results[0], Exception) else {"strongest_arguments": []}
        against_side = results[1] if not isinstance(results[1], Exception) else {"strongest_arguments": []}

        # Build arbitrator prompt with both sides
        debate_context = f"FOR position:\n{json.dumps(for_side)}\n\nAGAINST position:\n{json.dumps(against_side)}"
        arbitrator_result = await self._run_agent(ARBITRATOR_SYSTEM_PROMPT, debate_context)

        return {
            "mode": "debate",
            "for": for_side,
            "against": against_side,
            "arbitration": arbitrator_result,
        }

    async def _run_agent(self, system: str, situation: str) -> dict[str, Any]:
        try:
            response, _ = await self._router.generate(system, situation, max_tokens=1024)
            cleaned = clean_json_response(response)
            return json.loads(cleaned)
        except Exception as e:
            logger.warning("Debate agent failed: %s", e)
            return {}
