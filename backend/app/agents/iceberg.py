"""
Iceberg Report — maps visible and hidden parts of any situation.

Above surface → Level 1 → Level 2 → Level 3
Deeper levels are where Cognitus earns its value.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

ICEBERG_SYSTEM_PROMPT = """\
You are a depth analyst. Map the visible and hidden layers of this situation.
Go deeper with each level — the real insights are at Levels 2 and 3.

Respond ONLY with JSON:
{
    "above_surface": [
        {"observation": "<what everyone can see>", "obviousness": "<why it's obvious>"}
    ],
    "level_1": [
        {"observation": "<what careful observers notice>", "subtlety": "<why only some see it>"}
    ],
    "level_2": [
        {"observation": "<what experts would flag>", "expertise_required": "<domain expertise needed>"}
    ],
    "level_3": [
        {"observation": "<what almost nobody is seeing>", "why_missed": "<why it's invisible to almost everyone>"}
    ]
}
"""


class IcebergAnalyzer:
    """Iceberg analysis — maps visible to deepest hidden layers."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def analyze(self, situation: str) -> dict[str, Any]:
        try:
            response, _ = await self._router.generate(
                ICEBERG_SYSTEM_PROMPT, situation, max_tokens=2048
            )
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            return {
                "mode": "iceberg",
                "layers": {
                    "above_surface": data.get("above_surface", []),
                    "level_1": data.get("level_1", []),
                    "level_2": data.get("level_2", []),
                    "level_3": data.get("level_3", []),
                },
                "total_insights": sum(
                    len(data.get(k, []))
                    for k in ("above_surface", "level_1", "level_2", "level_3")
                ),
            }
        except Exception as e:
            logger.warning("Iceberg analysis failed: %s", e)
            return {"mode": "iceberg", "layers": {}, "error": str(e)}
