"""
Cascade Mapper — maps consequences of a decision at 5 levels.

Immediate → 2nd Order → 3rd Order → Unexpected → Irreversible
Canvas renders as clickable tree structure.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

CASCADE_SYSTEM_PROMPT = """\
You are a consequence mapping analyst. Given a decision or event, map its consequences
at 5 levels. Be specific and concrete — avoid vague statements.

Levels:
1. Immediate: What happens next (hours to days)
2. 2nd Order: What those trigger (weeks to months)
3. 3rd Order: What those trigger (months to years)
4. Unexpected: Consequences nobody typically maps
5. Irreversible: Which cannot be undone

Respond ONLY with JSON:
{
    "immediate": [{"consequence": "<specific>", "probability": "<high|medium|low>", "entities_affected": ["<entity>"]}],
    "second_order": [{"consequence": "<specific>", "triggers": "<what triggers this>"}],
    "third_order": [{"consequence": "<specific>", "triggers": "<what triggers this>"}],
    "unexpected": [{"consequence": "<specific>", "why_unexpected": "<why most people miss this>"}],
    "irreversible": [{"consequence": "<specific>", "irreversibility": "<why it can't be undone>"}]
}
"""


class CascadeMapper:
    """Maps decision consequences at 5 levels as a clickable tree."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        try:
            response, _ = await self._router.generate(
                CASCADE_SYSTEM_PROMPT, situation, max_tokens=2048
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {
                "mode": "cascade_mapper",
                "levels": {
                    "immediate": data.get("immediate", []),
                    "second_order": data.get("second_order", []),
                    "third_order": data.get("third_order", []),
                    "unexpected": data.get("unexpected", []),
                    "irreversible": data.get("irreversible", []),
                },
                "total_consequences": sum(
                    len(data.get(k, []))
                    for k in ("immediate", "second_order", "third_order", "unexpected", "irreversible")
                ),
            }
        except Exception as e:
            logger.warning("Cascade mapping failed: %s", e)
            return {"mode": "cascade_mapper", "levels": {}, "error": str(e)}
