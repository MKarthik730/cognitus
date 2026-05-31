"""
Assumption Excavator — runs BEFORE the main pipeline to identify hidden assumptions.

Works across all analysis modes. Shows each assumption with 3 options:
  [Confirm] [Deny] [Modify]

Only confirmed/modified assumptions pass to pipeline.
Denied assumptions explicitly excluded from context.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response

# Deferred imports to avoid circular import
# Assumption from app.graph.state is imported lazily (it's a TypedDict, used only for type hints)
# get_llm_router from app.services.llm_router is imported lazily

logger = logging.getLogger(__name__)

_Assumption = None
def _get_assumption():
    global _Assumption
    if _Assumption is None:
        from app.graph.state import Assumption
        _Assumption = Assumption
    return _Assumption


def _get_router():
    """Get the current LLM router.

    Unlike the old approach, this does NOT cache at module level,
    so reset_llm_router() updates are picked up immediately.
    """
    from app.services.llm_router import get_llm_router
    return get_llm_router()

EXCAVATOR_SYSTEM_PROMPT = """\
You are an assumption excavator. Given a situation, identify every hidden assumption,
bias, or unstated belief embedded in the text. Be exhaustive — missed assumptions lead
to flawed conclusions.

For each assumption, provide:
- assumption: The specific hidden assumption
- category: factual | cultural | emotional | logical | temporal | relational
- importance: critical | moderate | minor

Respond ONLY with a JSON object. No preamble, no markdown fences:
{
    "assumptions": [
        {
            "assumption": "<specific hidden assumption>",
            "category": "<category>",
            "importance": "<critical|moderate|minor>",
            "why_hidden": "<why this assumption is not obvious>"
        }
    ]
}
"""


class AssumptionExcavator:
    """Excavates hidden assumptions from user input before pipeline execution."""

    def __init__(self) -> None:
        self._router = _get_router()

    async def excavate(self, situation: str) -> list[Assumption]:
        """Run assumption excavation on the given situation."""
        try:
            response, _ = await self._router.generate(
                EXCAVATOR_SYSTEM_PROMPT,
                situation,
                max_tokens=1024,
            )
            return self._parse(response) or []
        except Exception as e:
            logger.warning("Assumption excavation failed: %s", e)
            return []

    async def excavate_with_fallback(self, situation: str) -> list[Assumption]:
        """Excavate assumptions, falling back to a basic heuristic set."""
        assumptions = await self.excavate(situation)
        if assumptions:
            return assumptions
        # Fallback: basic heuristic assumptions
        return [
            Assumption(
                assumption="The situation has been described honestly and accurately",
                category="factual",
                importance="critical",
                why_hidden="Default assumption — user may omit key details",
            ),
            Assumption(
                assumption="The description contains all relevant information",
                category="logical",
                importance="critical",
                why_hidden="Users naturally omit context they assume is shared",
            ),
        ]

    def _parse(self, raw: str) -> list[Assumption] | None:
        """Parse the LLM response into a list of Assumptions."""
        try:
            cleaned = clean_json_response(raw)
            data = json.loads(cleaned)
            raw_assumptions = data.get("assumptions", [])
            return [
                Assumption(
                    assumption=a.get("assumption", ""),
                    category=a.get("category", "factual"),
                    importance=a.get("importance", "moderate"),
                    why_hidden=a.get("why_hidden", ""),
                )
                for a in raw_assumptions
            ]
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse assumption excavation: %s", e)
            return None
