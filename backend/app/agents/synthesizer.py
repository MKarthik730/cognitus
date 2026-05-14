from __future__ import annotations

from backend.app.core.config import settings
from backend.app.graph.state import (
    ConfidenceLevel,
    CrossCheckOutput,
    ExpertOutput,
    SynthesisOutput,
)
from backend.app.services.hf_service import HFService

SYNTHESIZER_SYSTEM_PROMPT = (
    "You are a chief synthesizer. You have received analyses from multiple domain experts "
    "along with a cross-check analysis identifying contradictions and agreements. "
    "Your task is to synthesize all perspectives into a unified, actionable conclusion.\n\n"
    "If the evidence is evenly split or the consensus score is exactly 0.5, your verdict "
    "should be: 'Context-dependent — the evidence is inconclusive.'\n\n"
    "Output in this exact format:\n"
    "VERDICT: <concise verdict>\n"
    "REASONING: <detailed reasoning that reconciles different expert perspectives>\n"
    "CONFIDENCE: <high|medium|low>\n"
    "CONSENSUS_SCORE: <0.0-1.0>"
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
            sections.append(
                f"[{domain.upper()}]\n"
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

    @staticmethod
    def _parse_response(text: str) -> tuple[str, str, ConfidenceLevel, float]:
        verdict = ""
        reasoning = ""
        confidence: ConfidenceLevel = "medium"
        consensus_score = 0.5

        lines = text.splitlines()
        reasoning_lines: list[str] = []
        in_reasoning = False

        for line in lines:
            if line.startswith("VERDICT:"):
                verdict = line[len("VERDICT:") :].strip()
            elif line.startswith("REASONING:"):
                in_reasoning = True
                rest = line[len("REASONING:") :].strip()
                if rest:
                    reasoning_lines.append(rest)
            elif line.startswith("CONFIDENCE:"):
                in_reasoning = False
                conf = line[len("CONFIDENCE:") :].strip().lower()
                if conf in ("high", "medium", "low"):
                    confidence = conf  # type: ignore[assignment]
            elif line.startswith("CONSENSUS_SCORE:"):
                in_reasoning = False
                try:
                    score = float(line.split(":", 1)[1].strip())
                    consensus_score = max(0.0, min(1.0, score))
                except ValueError:
                    pass
            elif in_reasoning:
                reasoning_lines.append(line)

        reasoning = " ".join(reasoning_lines).strip()
        return verdict, reasoning, confidence, consensus_score

    async def synthesize(
        self,
        situation: str,
        experts: dict[str, ExpertOutput],
        cross_check: CrossCheckOutput,
    ) -> SynthesisOutput:
        user_prompt = self._build_user_prompt(situation, experts, cross_check)
        response, model = await self.hf_service.generate(
            SYNTHESIZER_SYSTEM_PROMPT,
            user_prompt,
            max_tokens=settings.HF_SYNTHESIS_MAX_TOKENS,
        )
        verdict, reasoning, confidence, consensus_score = self._parse_response(response)

        return SynthesisOutput(
            verdict=verdict or "Unable to produce a verdict.",
            reasoning=reasoning or response,
            confidence=confidence,
            consensus_score=consensus_score,
            model_used=model,
            processing_time_ms=0,
        )
