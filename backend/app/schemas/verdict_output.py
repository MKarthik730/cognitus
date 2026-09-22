"""Structured schemas for the Verdict trust layer.

These extend (never replace) the existing NodeOutput/ExpertOutput schemas —
see app/schemas/node_output.py. The one rule that matters everywhere these
are consumed: a `VerdictScorecard.action_taken` of "auto_approved" is only
ever valid when every `DeterministicCheckResult.status == "pass"` and every
`ClaimMatchResult.verdict == "match"`. That rule is enforced in code
(app/agents/verdict_synthesizer.py), not trusted to an LLM to decide.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.node_output import NodeOutput

CheckName = Literal["tests", "static_analysis", "coverage", "cve", "secrets"]
CheckStatus = Literal["pass", "fail", "error", "skipped_no_data"]
ClaimVerdict = Literal["match", "mismatch", "partial", "unsupported"]
ActionTaken = Literal["auto_approved", "blocked_for_review", "issue_filed", "action_failed"]


class DeterministicCheckResult(BaseModel):
    """One fact produced by the deterministic layer — no LLM involved."""

    check_name: CheckName
    status: CheckStatus
    detail: str
    raw_output: str | None = Field(
        default=None, description="Captured stdout/stderr for transparency"
    )


class ClaimMatchResult(BaseModel):
    """Does the diff actually contain evidence for a specific claim?"""

    claim: str = Field(description="What the AI/opinion said it did")
    verdict: ClaimVerdict
    supporting_lines: list[str] = Field(
        default_factory=list,
        description="Actual diff lines quoted as evidence — empty list = unsupported",
    )
    confidence: int = Field(
        ge=0, le=100,
        description="0-100, but never shown alone — always paired with evidence",
    )


class OpinionFinding(NodeOutput):
    """A single opinion-layer expert's finding, tagged with its domain.

    Extends NodeOutput (not replaced) purely to carry the domain label —
    everything else is identical to the existing expert schema.
    """

    domain: str


class VerdictScorecard(BaseModel):
    """The itemized result of a Verdict run — never collapsed to one sentence."""

    pr_url: str
    deterministic_checks: list[DeterministicCheckResult] = Field(default_factory=list)
    opinion_findings: list[OpinionFinding] = Field(default_factory=list)
    claim_matches: list[ClaimMatchResult] = Field(default_factory=list)
    unintended_scope: list[str] = Field(
        default_factory=list,
        description="AST-diff findings outside stated intent",
    )
    action_taken: ActionTaken
    action_reason: str


def all_checks_pass(checks: list[DeterministicCheckResult]) -> bool:
    """True only if every deterministic check explicitly passed.

    A "skipped_no_data" check (e.g. no test suite found) is deliberately
    NOT treated as a pass — that distinction is the entire point of the
    deterministic layer.
    """
    return len(checks) > 0 and all(c.status == "pass" for c in checks)


def all_claims_match(claims: list[ClaimMatchResult]) -> bool:
    """True only if every claim was verified as matching the diff."""
    return len(claims) > 0 and all(c.verdict == "match" for c in claims)
