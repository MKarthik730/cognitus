"""Hardcoded gating logic — the whole reason Verdict exists.

`action_taken = "auto_approved"` is only ever produced when every
deterministic check passed AND every claim match matched. This is a plain
Python `if`, not a prompt, and `_enforce_gate` re-checks it defensively
before the scorecard leaves this module — the point of the project is not
trusting an LLM with exactly this kind of judgment call.
"""

from __future__ import annotations

from app.schemas.verdict_output import (
    ClaimMatchResult,
    DeterministicCheckResult,
    OpinionFinding,
    VerdictScorecard,
    all_checks_pass,
    all_claims_match,
)


class GateIntegrityError(RuntimeError):
    """Raised if a scorecard would violate the auto-approval gate invariant."""


def _enforce_gate(scorecard: VerdictScorecard) -> None:
    if scorecard.action_taken != "auto_approved":
        return
    if not all_checks_pass(scorecard.deterministic_checks):
        raise GateIntegrityError(
            "Refusing to auto-approve: not every deterministic check passed."
        )
    if not all_claims_match(scorecard.claim_matches):
        raise GateIntegrityError(
            "Refusing to auto-approve: not every claim was verified as a match."
        )
    if scorecard.unintended_scope:
        raise GateIntegrityError(
            "Refusing to auto-approve: unintended scope was flagged."
        )


def _describe_failures(
    deterministic_checks: list[DeterministicCheckResult],
    claim_matches: list[ClaimMatchResult],
    unintended_scope: list[str],
) -> str:
    parts: list[str] = []

    failing_checks = [c for c in deterministic_checks if c.status != "pass"]
    if failing_checks:
        parts.append(
            "Deterministic checks not passing: "
            + "; ".join(f"{c.check_name}={c.status} ({c.detail})" for c in failing_checks)
        )

    bad_claims = [c for c in claim_matches if c.verdict != "match"]
    if bad_claims:
        parts.append(
            "Claims not verified as matching the diff: "
            + "; ".join(f'"{c.claim}" -> {c.verdict}' for c in bad_claims)
        )

    if unintended_scope:
        parts.append("Unintended scope flagged: " + "; ".join(unintended_scope))

    return " | ".join(parts) if parts else "All gates passed."


class VerdictSynthesizer:
    """Assembles the final VerdictScorecard and decides the gate outcome."""

    def synthesize(
        self,
        pr_url: str,
        deterministic_checks: list[DeterministicCheckResult],
        opinion_findings: list[OpinionFinding],
        claim_matches: list[ClaimMatchResult],
        unintended_scope: list[str] | None = None,
    ) -> VerdictScorecard:
        unintended_scope = unintended_scope or []

        checks_pass = all_checks_pass(deterministic_checks)
        claims_match = all_claims_match(claim_matches)
        no_scope_creep = len(unintended_scope) == 0

        if checks_pass and claims_match and no_scope_creep:
            action_taken = "auto_approved"
            action_reason = (
                f"All {len(deterministic_checks)} deterministic check(s) passed and all "
                f"{len(claim_matches)} claim(s) were verified against the diff. Auto-approved."
            )
        else:
            action_taken = "blocked_for_review"
            action_reason = _describe_failures(
                deterministic_checks, claim_matches, unintended_scope
            )

        scorecard = VerdictScorecard(
            pr_url=pr_url,
            deterministic_checks=deterministic_checks,
            opinion_findings=opinion_findings,
            claim_matches=claim_matches,
            unintended_scope=unintended_scope,
            action_taken=action_taken,
            action_reason=action_reason,
        )

        _enforce_gate(scorecard)
        return scorecard
