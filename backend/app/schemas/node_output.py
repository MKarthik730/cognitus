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
    """Structured output from the synthesizer node."""

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


# Hallucination detection patterns
PLACEHOLDER_PATTERNS: list[str] = [
    "string",
    "example",
    "lorem",
    "n/a",
    "not available",
    "not applicable",
    "to be determined",
    "tbd",
    "...",
    "insert",
    "placeholder",
]


def is_hallucinated(output: NodeOutput) -> bool:
    """Detect if a node output contains hallucinated or placeholder content.

    Checks for:
    1. Placeholder patterns in the text
    2. Minimum reasoning length requirement
    """
    all_text = (
        f"{output.position} {output.reasoning} {' '.join(output.key_findings)}"
    ).lower()

    for pattern in PLACEHOLDER_PATTERNS:
        if pattern in all_text:
            logger.warning(
                "Hallucination detected: placeholder pattern '%s' found in output",
                pattern,
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
    """Clean a raw LLM response to extract valid JSON.

    Strips markdown code fences, leading/trailing whitespace,
    and any text before the first '{' or after the last '}'.
    """
    text = raw.strip()

    # Remove markdown code fences (```json ... ``` or ``` ... ```)
    if text.startswith("```"):
        lines = text.split("\n")
        fence_start = 0
        fence_end = len(lines)

        # Find the first ``` (opening fence)
        for i, line in enumerate(lines):
            if line.strip().startswith("```"):
                fence_start = i + 1
                break

        # Find the last ``` (closing fence)
        for i in range(len(lines) - 1, fence_start - 1, -1):
            if lines[i].strip().startswith("```"):
                fence_end = i
                break

        text = "\n".join(lines[fence_start:fence_end]).strip()

    # Find the first { and last }
    first_brace = text.find("{")
    last_brace = text.rfind("}")

    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        text = text[first_brace : last_brace + 1]

    return text.strip()


def confidence_to_level(confidence_int: int) -> str:
    """Convert an integer confidence (0-100) to a string level."""
    if confidence_int >= 67:
        return "high"
    elif confidence_int >= 34:
        return "medium"
    else:
        return "low"
