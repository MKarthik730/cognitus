from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)


class NodeOutput(BaseModel):
    """Structured output parsed from an expert node's LLM response."""

    confidence: int = Field(ge=0, le=100, description="Confidence score 0-100")
    position: str = Field(min_length=1, description="The node's position/stance")
    reasoning: str = Field(min_length=1, description="Detailed reasoning")
    key_findings: list[str] = Field(
        min_length=1, description="Key findings from the analysis"
    )
    concerns: list[str] = Field(
        default_factory=list, description="Concerns or risks identified"
    )
    revision: str | None = Field(
        default=None,
        description="Revised position after cross-examination, if any",
    )


class CrossExamineOutput(BaseModel):
    """Structured output from the cross-examination phase."""

    maintains_position: bool = Field(
        description="Whether the node maintains its original position"
    )
    revision: str | None = Field(
        default=None,
        description="Revised position if not maintaining original",
    )
    points_of_agreement: list[str] = Field(
        description="Points where this node agrees with other nodes"
    )
    points_of_disagreement: list[str] = Field(
        description="Points where this node disagrees with other nodes"
    )


class CrossCheckResult(BaseModel):
    """Structured output from the cross-check coordinator."""

    contradictions: list[dict[str, Any]] = Field(
        description="List of contradictions between nodes"
    )
    agreements: list[dict[str, Any]] = Field(
        description="List of agreements between nodes"
    )
    consensus_score: float = Field(
        ge=0.0, le=1.0, description="Overall consensus score 0.0-1.0"
    )


class SynthesisResult(BaseModel):
    """Structured output from the synthesizer node with Intelligence Layer fields."""

    verdict: str = Field(min_length=1, description="The final verdict")
    reasoning: str = Field(min_length=1, description="Synthesis reasoning")
    confidence: str = Field(
        default="medium",
        description="Overall confidence level: high, medium, or low",
    )
    consensus_score: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Consensus score 0.0-1.0"
    )
    critical_findings: list[str] = Field(
        default_factory=list, description="Critical findings that require attention"
    )
    recommendations: list[str] = Field(
        default_factory=list, description="Actionable recommendations"
    )
    unresolved_disagreements: list[str] = Field(
        default_factory=list, description="Unresolved disagreements between nodes"
    )
    # Intelligence Layer additions
    minority_report: str | None = Field(
        default=None,
        description="Single strongest dissenting expert opinion",
    )
    what_would_change_my_mind: list[str] = Field(
        default_factory=list,
        description="Conditions that would change the verdict",
    )
    confidence_breakdown: dict[str, float] | None = Field(
        default=None,
        description="Multi-dimensional confidence breakdown",
    )
    situation_dna: dict[str, str] | None = Field(
        default=None,
        description="Auto-generated situation profile",
    )


class DistributorResult(BaseModel):
    """Structured output from the distributor node."""

    domains: list[str] = Field(
        min_length=1, description="Selected domain names for expert analysis"
    )
    reasoning: str = Field(description="Reasoning for domain selection")


class NodeSelectorResult(BaseModel):
    """Structured output from the node selector."""

    nodes: list[dict[str, str]] = Field(
        min_length=1,
        description="List of selected nodes with name, role, and behavior",
    )


# ---------------------------------------------------------------------------
# New mode output schemas
# ---------------------------------------------------------------------------


class AssumptionResult(BaseModel):
    """Structured output from the assumption excavator."""

    assumptions: list[dict[str, str]] = Field(
        description="List of assumptions with category and importance"
    )


class SignalNoiseResult(BaseModel):
    """Structured output from signal vs noise analysis."""

    signals: list[dict[str, Any]] = Field(default_factory=list)
    noise: list[dict[str, Any]] = Field(default_factory=list)
    gaps: list[dict[str, Any]] = Field(default_factory=list)


class CascadeResult(BaseModel):
    """Structured output from cascade mapper."""

    immediate: list[dict[str, Any]] = Field(default_factory=list)
    second_order: list[dict[str, Any]] = Field(default_factory=list)
    third_order: list[dict[str, Any]] = Field(default_factory=list)
    unexpected: list[dict[str, Any]] = Field(default_factory=list)
    irreversible: list[dict[str, Any]] = Field(default_factory=list)


class PreMortemResult(BaseModel):
    """Structured output from pre-mortem analysis."""

    failure_scenarios: list[dict[str, Any]] = Field(default_factory=list)
    most_likely_failure: str = Field(default="")
    critical_fix: str = Field(default="")
    confidence: str = Field(default="")


class DebateResult(BaseModel):
    """Structured output from debate analysis."""

    for_position: dict[str, Any] = Field(default_factory=dict)
    against_position: dict[str, Any] = Field(default_factory=dict)
    arbitration: dict[str, Any] = Field(default_factory=dict)


class ReverseEngineerResult(BaseModel):
    """Structured output from reverse engineering."""

    surface_cause: dict[str, Any] = Field(default_factory=dict)
    real_cause: dict[str, Any] = Field(default_factory=dict)
    root_cause: dict[str, Any] = Field(default_factory=dict)
    prevention: dict[str, Any] = Field(default_factory=dict)
    confidence: str = Field(default="medium")


class IcebergResult(BaseModel):
    """Structured output from iceberg analysis."""

    above_surface: list[dict[str, Any]] = Field(default_factory=list)
    level_1: list[dict[str, Any]] = Field(default_factory=list)
    level_2: list[dict[str, Any]] = Field(default_factory=list)
    level_3: list[dict[str, Any]] = Field(default_factory=list)


class StressTestResult(BaseModel):
    """Structured output from stress testing."""

    scenarios: list[dict[str, Any]] = Field(default_factory=list)
    overall_robustness: str = Field(default="medium")
    weakest_point: str = Field(default="")


class ChatRouterResult(BaseModel):
    """Structured output from chat routing."""

    node_name: str = Field(description="Selected node for response")
    node_persona: str = Field(default="")
    reason: str = Field(default="")


# ---------------------------------------------------------------------------
# Hallucination detection patterns
# ---------------------------------------------------------------------------

PLACEHOLDER_PATTERNS: list[tuple[str, str]] = [
    (r"\bplaceholder\b", "placeholder"),
    (r"\blorem ipsum\b", "lorem ipsum"),
    (r"\bn/a\b", "n/a"),
    (r"\bnot available\b", "not available"),
    (r"\bnot applicable\b", "not applicable"),
    (r"\bto be determined\b", "to be determined"),
    (r"\btbd\b", "tbd"),
    (r"\u2026|\\ldots\b", "ellipsis"),
    (r"\[\s*\.{3,}\s*\]", "bracket ellipsis"),
]


def is_hallucinated(output: NodeOutput) -> bool:
    """Detect if a node output contains hallucinated or placeholder content."""
    import re

    all_text = (
        f"{output.position} {output.reasoning} {' '.join(output.key_findings)}"
    ).lower()

    for pattern, reason in PLACEHOLDER_PATTERNS:
        if re.search(pattern, all_text):
            logger.warning(
                "Hallucination detected: placeholder pattern '%s' found in output (reason: %s)",
                pattern, reason,
            )
            return True

    if len(output.reasoning) < 50:
        logger.warning(
            "Hallucination detected: reasoning too short (%d chars, min 50)",
            len(output.reasoning),
        )
        return True

    return False


def clean_json_response(raw: str) -> str:
    """Clean a raw LLM response to extract valid JSON."""
    text = raw.strip()

    # Remove markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        fence_start = 0
        fence_end = len(lines)

        for i, line in enumerate(lines):
            if line.strip().startswith("```"):
                fence_start = i + 1
                break

        for i in range(len(lines) - 1, fence_start - 1, -1):
            if lines[i].strip().startswith("```"):
                fence_end = i
                break

        text = "\n".join(lines[fence_start:fence_end]).strip()

    # Find outermost JSON structure
    first_brace = text.find("{")
    first_bracket = text.find("[")

    if first_brace != -1 and (first_bracket == -1 or first_brace < first_bracket):
        last_brace = text.rfind("}")
        if last_brace > first_brace:
            text = text[first_brace : last_brace + 1]
    elif first_bracket != -1:
        last_bracket = text.rfind("]")
        if last_bracket > first_bracket:
            text = text[first_bracket : last_bracket + 1]
            inner = text.strip()
            if inner.startswith("[") and inner.endswith("]"):
                inner_content = inner[1:-1].strip()
                if inner_content.startswith("{") and inner_content.endswith("}"):
                    text = inner_content

    return text.strip()


def confidence_to_level(confidence_int: int) -> str:
    """Convert an integer confidence (0-100) to a string level."""
    if confidence_int >= 67:
        return "high"
    elif confidence_int >= 34:
        return "medium"
    else:
        return "low"
