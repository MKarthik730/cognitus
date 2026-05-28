from __future__ import annotations

import json
import logging

from app.core.config import settings
from app.graph.state import (
    ConfidenceLevel,
    CrossCheckOutput,
    ExpertOutput,
    SynthesisOutput,
)
from app.schemas.node_output import clean_json_response
from app.services.hf_service import HFService

logger = logging.getLogger(__name__)

SYNTHESIZER_SYSTEM_PROMPT = """
You are a chief synthesizer. You have received analyses from multiple domain experts
along with a cross-check analysis identifying contradictions and agreements.
Your task is to synthesize all perspectives into a unified, actionable conclusion.

If the evidence is evenly split or the consensus score is exactly 0.5, your verdict
should state that the evidence is inconclusive.

Respond ONLY with a JSON object. No preamble, no markdown fences, no explanation outside the JSON:
{
    "verdict": "<concise verdict>",
    "reasoning": "<detailed reasoning that reconciles different expert perspectives>",
    "confidence": "high" | "medium" | "low",
    "consensus_score": <0.0-1.0>
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object."
)


class SynthesizerNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    @staticmethod
    def _build_user_prompt(
        situation: str,
        experts: dict[str, ExpertOutput],
        cross_check: CrossCheckOutput,
    ) -> str:
        sections: list[str] = [f"SITUATION: {situation}\n"]

        sections.append("--- EXPERT ANALYSES ---\n")
        for domain, output in experts.items():
            position = output.get("position") or ""
            key_findings = output.get("key_findings") or []
            concerns = output.get("concerns") or []

            sections.append(
                f"[{domain.upper()}]\n"
                f"Position: {position}\n"
                f"Key Findings: {'; '.join(key_findings)}\n"
                f"Concerns: {'; '.join(concerns)}\n"
                f"Analysis: {output['analysis']}\n"
                f"Confidence: {output['confidence']}\n"
            )

        sections.append("\n--- CROSS-CHECK ANALYSIS ---\n")
        sections.append(f"Consensus Score: {cross_check['consensus_score']}\n")

        if cross_check.get("contradictions"):
            sections.append("Contradictions:\n")
            for c in cross_check["contradictions"]:
                sections.append(
                    f"  - {c['between'][0]} vs {c['between'][1]}: "
                    f"{c['description']} ({c['severity']})\n"
                )

        if cross_check.get("agreements"):
            sections.append("Agreements:\n")
            for a in cross_check["agreements"]:
                sections.append(
                    f"  - {a['between'][0]} & {a['between'][1]}: "
                    f"{'; '.join(a['points'])}\n"
                )

        return "".join(sections)

    async def synthesize(
        self,
        situation: str,
        experts: dict[str, ExpertOutput],
        cross_check: CrossCheckOutput,
    ) -> SynthesisOutput:
        user_prompt = self._build_user_prompt(situation, experts, cross_check)
        verdict = ""
        reasoning = ""
        confidence: ConfidenceLevel = "medium"
        consensus_score = 0.5
        model_used = ""

        response, model = await self._generate_synthesis(user_prompt, is_retry=False)

        if response:
            parsed = self._try_parse(response)
            if parsed:
                verdict = parsed.get("verdict", "")
                reasoning = parsed.get("reasoning", "")
                conf = parsed.get("confidence", "medium")
                if conf in ("high", "medium", "low"):
                    confidence = conf  # type: ignore[assignment]
                consensus_score = max(0.0, min(1.0, parsed.get("consensus_score", 0.5)))
                model_used = model
            else:
                # Retry once
                logger.warning("Synthesizer JSON parse failed, retrying...")
                response2, model2 = await self._generate_synthesis(
                    user_prompt, is_retry=True
                )
                if response2:
                    parsed2 = self._try_parse(response2)
                    if parsed2:
                        verdict = parsed2.get("verdict", "")
                        reasoning = parsed2.get("reasoning", "")
                        conf = parsed2.get("confidence", "medium")
                        if conf in ("high", "medium", "low"):
                            confidence = conf  # type: ignore[assignment]
                        consensus_score = max(
                            0.0, min(1.0, parsed2.get("consensus_score", 0.5))
                        )
                        model_used = model2

        return SynthesisOutput(
            verdict=verdict or response or "Unable to produce a verdict.",
            reasoning=reasoning or response or "",
            confidence=confidence,
            consensus_score=consensus_score,
            model_used=model_used,
            processing_time_ms=0,
        )

    def _try_parse(self, raw: str) -> dict | None:
        """Attempt to parse a raw response as JSON."""
        try:
            cleaned = clean_json_response(raw)
            return json.loads(cleaned)
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse synthesis JSON: %s", e)
            return None

    async def _generate_synthesis(
        self, user_prompt: str, is_retry: bool = False
    ) -> tuple[str | None, str]:
        """Generate synthesis with optional retry."""
        system = SYNTHESIZER_SYSTEM_PROMPT
        if is_retry:
            system = system + RETRY_PROMPT

        try:
            response, model = await self.hf_service.generate(
                system,
                user_prompt,
                max_tokens=settings.HF_SYNTHESIS_MAX_TOKENS,
            )
            return response, model
        except Exception as e:
            logger.error("Synthesis generation failed: %s", e)
            return None, ""
