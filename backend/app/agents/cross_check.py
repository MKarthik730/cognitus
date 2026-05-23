from __future__ import annotations

import json
import logging

from backend.app.core.config import settings
from backend.app.graph.state import CrossCheckOutput, ExpertOutput
from backend.app.schemas.node_output import clean_json_response
from backend.app.services.hf_service import HFService

logger = logging.getLogger(__name__)

CROSS_CHECK_SYSTEM_PROMPT = """
You are a cross-check analyst. Compare the expert analyses below and identify
contradictions and agreements between domain experts. For each pair of domains,
determine if they directly contradict, partially disagree, or complement each other.

Respond ONLY with a JSON object. No preamble, no markdown fences, no explanation outside the JSON:
{
    "contradictions": [
        {
            "between": ["<domain_a>", "<domain_b>"],
            "type": "direct" | "partial" | "complementary",
            "description": "<string>",
            "severity": "high" | "medium" | "low"
        }
    ],
    "agreements": [
        {
            "between": ["<domain_a>", "<domain_b>"],
            "points": ["<point1>", "<point2>"]
        }
    ],
    "consensus_score": <0.0-1.0>
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object."
)


def _build_user_prompt(experts: dict[str, ExpertOutput]) -> str:
    sections: list[str] = []
    for domain, output in experts.items():
        # Use structured fields if available, fall back to raw analysis
        position = output.get("position") or ""
        key_findings = output.get("key_findings") or []
        concerns = output.get("concerns") or []
        analysis = output.get("analysis", "")
        citations = output.get("citations")
        citations_block = f"Citations: {', '.join(citations)}\n" if citations else ""

        sections.append(
            f"[{domain.upper()} EXPERT]\n"
            f"Position: {position}\n"
            f"Key Findings: {'; '.join(key_findings)}\n"
            f"Concerns: {'; '.join(concerns)}\n"
            f"Analysis: {analysis}\n"
            f"Confidence: {output['confidence']}\n"
            f"{citations_block}"
            f"Processing time: {output['processing_time_ms']}ms\n"
        )
    return "\n".join(sections)


class CrossCheckNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    async def cross_check(self, experts: dict[str, ExpertOutput]) -> CrossCheckOutput:
        user_prompt = _build_user_prompt(experts)
        contradictions_data = []
        agreements_data = []
        consensus_score = 0.5
        model_used = ""

        response, model = await self._generate_cross_check(user_prompt, is_retry=False)

        if response:
            try:
                cleaned = clean_json_response(response)
                data = json.loads(cleaned)
                contradictions_data = data.get("contradictions", [])
                agreements_data = data.get("agreements", [])
                consensus_score = max(0.0, min(1.0, data.get("consensus_score", 0.5)))
                model_used = model
            except (json.JSONDecodeError, ValueError, TypeError) as e:
                logger.warning("Failed to parse cross-check JSON: %s", e)
                # Fall back: try again with retry prompt
                response2, model2 = await self._generate_cross_check(
                    user_prompt, is_retry=True
                )
                if response2:
                    try:
                        cleaned2 = clean_json_response(response2)
                        data2 = json.loads(cleaned2)
                        contradictions_data = data2.get("contradictions", [])
                        agreements_data = data2.get("agreements", [])
                        consensus_score = max(
                            0.0, min(1.0, data2.get("consensus_score", 0.5))
                        )
                        model_used = model2
                    except (json.JSONDecodeError, ValueError, TypeError) as e2:
                        logger.error("Cross-check JSON parse failed after retry: %s", e2)

        return CrossCheckOutput(
            contradictions=[
                {
                    "between": (c["between"][0], c["between"][1]),
                    "type": c.get("type", "partial"),
                    "description": c.get("description", ""),
                    "severity": c.get("severity", "medium"),
                }
                for c in contradictions_data
            ],
            agreements=[
                {
                    "between": (a["between"][0], a["between"][1]),
                    "points": a.get("points", []),
                }
                for a in agreements_data
            ],
            consensus_score=consensus_score,
            model_used=model_used,
        )

    async def _generate_cross_check(
        self, user_prompt: str, is_retry: bool = False
    ) -> tuple[str | None, str]:
        """Generate cross-check analysis with optional retry."""
        system = CROSS_CHECK_SYSTEM_PROMPT
        if is_retry:
            system = system + RETRY_PROMPT

        try:
            response, model = await self.hf_service.generate(
                system,
                user_prompt,
                max_tokens=settings.HF_DEFAULT_MAX_TOKENS,
            )
            return response, model
        except Exception as e:
            logger.error("Cross-check generation failed: %s", e)
            return None, ""
