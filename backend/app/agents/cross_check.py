from __future__ import annotations

from typing import get_args

from backend.app.graph.state import (
    Agreement,
    ConfidenceLevel,
    Contradiction,
    ContradictionType,
    CrossCheckOutput,
    DomainName,
    ExpertOutput,
)
from backend.app.services.hf_service import HFService

CROSS_CHECK_SYSTEM_PROMPT = (
    "You are a cross-check analyst. Compare the expert analyses below and identify "
    "contradictions and agreements between domain experts. For each pair of domains, "
    "determine if they directly contradict, partially disagree, or complement each other. "
    "Output in this exact format:\n\n"
    "CONTRADICTION: <domain_a>, <domain_b>, <direct|partial|complementary>, "
    "<high|medium|low>, <description>\n"
    "AGREEMENT: <domain_a>, <domain_b>, <point1> | <point2> | ...\n"
    "CONSENSUS_SCORE: <0.0-1.0>\n\n"
    "List all contradictions and agreements between every domain pair."
)

_VALID_DOMAINS: set[str] = set(get_args(DomainName))
_VALID_CONFIDENCE: set[str] = set(get_args(ConfidenceLevel))
_VALID_CONTRADICTION_TYPES: set[str] = set(get_args(ContradictionType))


def _build_user_prompt(experts: dict[str, ExpertOutput]) -> str:
    sections: list[str] = []
    for domain, output in experts.items():
        sections.append(
            f"[{domain.upper()} EXPERT]\n"
            f"Analysis: {output['analysis']}\n"
            f"Confidence: {output['confidence']}\n"
        )
    return "\n".join(sections)


def _parse_contradictions(text: str) -> list[Contradiction]:
    results: list[Contradiction] = []
    for line in text.splitlines():
        if not line.startswith("CONTRADICTION:"):
            continue
        parts = [p.strip() for p in line[len("CONTRADICTION:") :].split(",")]
        if len(parts) < 5:
            continue
        domain_a, domain_b, ctype, severity, *desc_parts = parts
        if domain_a not in _VALID_DOMAINS or domain_b not in _VALID_DOMAINS:
            continue
        if ctype not in _VALID_CONTRADICTION_TYPES:
            ctype = "partial"
        if severity not in _VALID_CONFIDENCE:
            severity = "medium"
        results.append(
            Contradiction(
                between=(domain_a, domain_b),
                type=ctype,
                description=",".join(desc_parts).strip(),
                severity=severity,
            )
        )
    return results


def _parse_agreements(text: str) -> list[Agreement]:
    results: list[Agreement] = []
    for line in text.splitlines():
        if not line.startswith("AGREEMENT:"):
            continue
        parts = [p.strip() for p in line[len("AGREEMENT:") :].split(",", 2)]
        if len(parts) < 3:
            continue
        domain_a, domain_b, points_str = parts
        if domain_a not in _VALID_DOMAINS or domain_b not in _VALID_DOMAINS:
            continue
        points = [p.strip() for p in points_str.split("|") if p.strip()]
        results.append(Agreement(between=(domain_a, domain_b), points=points))
    return results


def _parse_consensus(text: str) -> float:
    for line in text.splitlines():
        if line.startswith("CONSENSUS_SCORE:"):
            try:
                val = float(line.split(":", 1)[1].strip())
                return max(0.0, min(1.0, val))
            except ValueError:
                return 0.5
    return 0.5


class CrossCheckNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    async def cross_check(self, experts: dict[str, ExpertOutput]) -> CrossCheckOutput:
        user_prompt = _build_user_prompt(experts)
        response, model = await self.hf_service.generate(
            CROSS_CHECK_SYSTEM_PROMPT, user_prompt
        )
        return CrossCheckOutput(
            contradictions=_parse_contradictions(response),
            agreements=_parse_agreements(response),
            consensus_score=_parse_consensus(response),
            model_used=model,
        )
