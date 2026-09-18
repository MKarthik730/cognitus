"""Verdict — the PR-review pipeline.

Ingestion -> deterministic layer (facts, no LLM) -> opinion layer (existing
ExpertNode pattern, reused with a fixed Backend/Security/DevOps/QA roster)
-> claim-vs-artifact matching (one narrow LLM check) -> synthesis (hardcoded
gate) -> action layer (gated GitHub write).

A separate StateGraph from CouncilGraph on purpose — a PR review has a
different shape (structured diff/metadata) and a different terminal
artifact (a gated VerdictScorecard) than the free-text council pipeline.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from langgraph.graph import END, StateGraph

from app.agents.claim_matcher import ClaimMatcher
from app.agents.expert_node import ExpertNode
from app.agents.verdict_synthesizer import VerdictSynthesizer
from app.graph.state import VerdictState
from app.ingestion.github_client import GitHubClient, GitHubClientError, parse_pr_url
from app.schemas.verdict_output import (
    ClaimMatchResult,
    DeterministicCheckResult,
    OpinionFinding,
    VerdictScorecard,
)
from app.services.hf_service import HFService
from app.verification.coverage_check import compute_diff_coverage
from app.verification.dependency_scanner import scan_dependencies
from app.verification.sandbox_runner import run_sandbox_tests
from app.verification.secret_scanner import scan_diff_for_secrets
from app.verification.static_analysis import run_bandit

logger = logging.getLogger(__name__)

EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]

MANIFEST_FILENAMES = ("requirements.txt", "package.json")

# The "Engineering Review" opinion roster — reused/repurposed per the build
# doc, since no fixed multi-node preset exists elsewhere in the codebase.
OPINION_ROSTER: dict[str, str] = {
    "backend": (
        "You are a senior backend engineer reviewing a pull request. You care about "
        "correctness, API contracts, data integrity, and whether the change actually does "
        "what the PR description claims. Flag anything that looks incomplete or risky."
    ),
    "security": (
        "You are a security engineer reviewing a pull request. You look for injection "
        "risks, auth/authz gaps, unsafe deserialization, secret handling, and anything "
        "that expands the attack surface. Be specific about what could go wrong."
    ),
    "devops": (
        "You are a DevOps lead reviewing a pull request. You care about deployability, "
        "config/env changes, dependency footprint, backward compatibility, and rollback "
        "safety. Flag anything that could break a deploy or an existing environment."
    ),
    "qa": (
        "You are a QA engineer reviewing a pull request. You care about test coverage, "
        "edge cases, and whether the diff's tests (if any) actually exercise the new "
        "behavior rather than just asserting it exists. Flag untested risk directly."
    ),
}


class VerdictGraph:
    def __init__(self, hf_service: HFService | None = None) -> None:
        self.hf_service = hf_service or HFService()
        self.claim_matcher = ClaimMatcher(self.hf_service)
        self.synthesizer = VerdictSynthesizer()
        self._emit: EventEmitter | None = None
        self._graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(VerdictState)

        workflow.add_node("ingest", self._run_ingestion)
        workflow.add_node("deterministic", self._run_deterministic_layer)
        workflow.add_node("opinion", self._run_opinion_layer)
        workflow.add_node("claims", self._run_claim_matcher)
        workflow.add_node("synthesize", self._run_synthesis)
        workflow.add_node("act", self._run_action_layer)

        workflow.set_entry_point("ingest")
        workflow.add_edge("ingest", "deterministic")
        workflow.add_edge("deterministic", "opinion")
        workflow.add_edge("opinion", "claims")
        workflow.add_edge("claims", "synthesize")
        workflow.add_edge("synthesize", "act")
        workflow.add_edge("act", END)

        return workflow.compile()

    async def _send(self, event: dict[str, Any]) -> None:
        if self._emit is not None:
            try:
                await self._emit(event)
            except Exception as e:
                logger.debug("Verdict event emit failed (non-fatal): %s", e)

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def _run_ingestion(self, state: VerdictState) -> dict[str, Any]:
        await self._send({"type": "verdict_ingest_start", "pr_url": state["pr_url"]})
        owner, repo, number = parse_pr_url(state["pr_url"])
        client = GitHubClient(state.get("github_token"))
        pr = await client.fetch_pr(owner, repo, number)

        diffs = {f.filename: (f.patch or "") for f in pr.files}

        # Full file content at head, but only for files a downstream check needs:
        # Python source (bandit) + dependency manifests (before/after).
        file_contents_head: dict[str, str] = {}
        manifests_after: dict[str, str] = {}
        manifests_before: dict[str, str] = {}

        for f in pr.files:
            if f.filename.endswith(".py") and f.status != "removed":
                content = await client.fetch_file_content(owner, repo, f.filename, pr.head_sha)
                if content is not None:
                    file_contents_head[f.filename] = content
            if f.filename.endswith(MANIFEST_FILENAMES):
                after = await client.fetch_file_content(owner, repo, f.filename, pr.head_sha)
                if after is not None:
                    manifests_after[f.filename] = after
                if f.status != "added":
                    before = await client.fetch_file_content(owner, repo, f.filename, pr.base_sha)
                    if before is not None:
                        manifests_before[f.filename] = before

        pr_metadata = {
            "owner": owner,
            "repo": repo,
            "number": number,
            "title": pr.title,
            "body": pr.body,
            "head_sha": pr.head_sha,
            "base_sha": pr.base_sha,
            "head_clone_url": pr.head_clone_url,
            "head_ref": pr.head_ref,
            "changed_files": [f.filename for f in pr.files],
        }

        await self._send({
            "type": "verdict_ingest_complete",
            "pr_metadata": pr_metadata,
            "files_changed": len(pr.files),
        })

        return {
            "pr_metadata": pr_metadata,
            "diffs": diffs,
            "file_contents_head": file_contents_head,
            "manifests_before": manifests_before,
            "manifests_after": manifests_after,
            "status": "deterministic_checks",
        }

    async def _run_deterministic_layer(self, state: VerdictState) -> dict[str, Any]:
        pr_metadata = state["pr_metadata"]
        diffs = state["diffs"]
        combined_diff = "\n".join(diffs.values())
        changed_and_root_files = pr_metadata["changed_files"] + [
            "requirements.txt", "package.json", "pytest.ini",
        ]

        async def _tests() -> tuple[DeterministicCheckResult, dict[str, set[int]]]:
            await self._send({"type": "verdict_check_start", "check_name": "tests"})
            result, coverage = await run_sandbox_tests(
                pr_metadata["head_clone_url"], pr_metadata["head_sha"], changed_and_root_files,
            )
            await self._send({"type": "verdict_check_complete", "check": result.model_dump()})
            return result, coverage

        async def _static() -> DeterministicCheckResult:
            await self._send({"type": "verdict_check_start", "check_name": "static_analysis"})
            result = await asyncio.to_thread(
                run_bandit, state["file_contents_head"], diffs,
            )
            await self._send({"type": "verdict_check_complete", "check": result.model_dump()})
            return result

        async def _secrets() -> DeterministicCheckResult:
            await self._send({"type": "verdict_check_start", "check_name": "secrets"})
            result = scan_diff_for_secrets(combined_diff)
            await self._send({"type": "verdict_check_complete", "check": result.model_dump()})
            return result

        async def _cve() -> DeterministicCheckResult:
            await self._send({"type": "verdict_check_start", "check_name": "cve"})
            result = await scan_dependencies(state["manifests_before"], state["manifests_after"])
            await self._send({"type": "verdict_check_complete", "check": result.model_dump()})
            return result

        (tests_result, coverage), static_result, secrets_result, cve_result = await asyncio.gather(
            _tests(), _static(), _secrets(), _cve(),
        )

        await self._send({"type": "verdict_check_start", "check_name": "coverage"})
        coverage_result = compute_diff_coverage(coverage, diffs)
        await self._send({"type": "verdict_check_complete", "check": coverage_result.model_dump()})

        checks = [tests_result, static_result, coverage_result, cve_result, secrets_result]
        return {
            "deterministic_checks": [c.model_dump() for c in checks],
            "covered_lines_by_file": {k: sorted(v) for k, v in coverage.items()},
            "status": "opinion_review",
        }

    async def _run_opinion_layer(self, state: VerdictState) -> dict[str, Any]:
        pr_metadata = state["pr_metadata"]
        diffs = state["diffs"]
        situation = (
            f"PR title: {pr_metadata['title']}\n"
            f"PR description: {pr_metadata['body']}\n\n"
            f"DIFF:\n" + "\n".join(f"--- {fn} ---\n{patch}" for fn, patch in diffs.items())
        )[:16000]

        async def _review(domain: str, behavior: str) -> OpinionFinding | None:
            await self._send({"type": "verdict_opinion_start", "domain": domain})
            node = ExpertNode(domain, self.hf_service, behavior=behavior)
            expert_output = await node.analyze(situation)
            finding = OpinionFinding(
                domain=domain,
                confidence=expert_output.get("confidence_score", 50),
                position=expert_output.get("position", "") or expert_output.get("analysis", "")[:200],
                reasoning=expert_output.get("reasoning", ""),
                key_findings=expert_output.get("key_findings", []) or ["No findings returned."],
                concerns=expert_output.get("concerns", []),
                evidence=expert_output.get("evidence", []),
                assumptions=expert_output.get("assumptions", []),
                uncertainty=expert_output.get("uncertainty", []),
            )
            await self._send({"type": "verdict_opinion_complete", "finding": finding.model_dump()})
            return finding

        results = await asyncio.gather(
            *[_review(domain, behavior) for domain, behavior in OPINION_ROSTER.items()],
            return_exceptions=True,
        )

        findings: list[dict] = []
        errors: list[str] = []
        for domain, result in zip(OPINION_ROSTER.keys(), results):
            if isinstance(result, Exception):
                errors.append(f"{domain}: {result}")
            elif result is not None:
                findings.append(result.model_dump())

        return {"opinion_findings": findings, "errors": errors, "status": "claim_matching"}

    async def _run_claim_matcher(self, state: VerdictState) -> dict[str, Any]:
        pr_metadata = state["pr_metadata"]
        diffs = state["diffs"]
        combined_diff = "\n".join(f"--- {fn} ---\n{patch}" for fn, patch in diffs.items())

        claims: list[str] = []
        if pr_metadata.get("body"):
            claims.append(f"{pr_metadata['title']}: {pr_metadata['body']}".strip())
        elif pr_metadata.get("title"):
            claims.append(pr_metadata["title"])

        for finding in state.get("opinion_findings", []):
            position = finding.get("position")
            if position and position not in claims:
                claims.append(position)

        async def _match_one(claim: str) -> ClaimMatchResult:
            await self._send({"type": "verdict_claim_start", "claim": claim})
            result = await self.claim_matcher.match(claim, combined_diff)
            await self._send({"type": "verdict_claim_complete", "match": result.model_dump()})
            return result

        matches = await asyncio.gather(*[_match_one(c) for c in claims[:6]])

        return {
            "claim_matches": [m.model_dump() for m in matches],
            "status": "synthesizing",
        }

    async def _run_synthesis(self, state: VerdictState) -> dict[str, Any]:
        checks = [DeterministicCheckResult(**c) for c in state.get("deterministic_checks", [])]
        findings = [OpinionFinding(**f) for f in state.get("opinion_findings", [])]
        matches = [ClaimMatchResult(**m) for m in state.get("claim_matches", [])]
        unintended_scope = state.get("unintended_scope", [])

        scorecard = self.synthesizer.synthesize(
            pr_url=state["pr_url"],
            deterministic_checks=checks,
            opinion_findings=findings,
            claim_matches=matches,
            unintended_scope=unintended_scope,
        )

        await self._send({
            "type": "verdict_gate_update",
            "gate": "unlocked" if scorecard.action_taken == "auto_approved" else "locked",
            "action_reason": scorecard.action_reason,
        })

        return {"scorecard": scorecard.model_dump(), "status": "acting"}

    async def _run_action_layer(self, state: VerdictState) -> dict[str, Any]:
        scorecard = VerdictScorecard(**state["scorecard"])
        pr_metadata = state["pr_metadata"]
        owner, repo, number = pr_metadata["owner"], pr_metadata["repo"], pr_metadata["number"]
        client = GitHubClient(state.get("github_token"))

        try:
            if scorecard.action_taken == "auto_approved":
                await client.post_review(
                    owner, repo, number,
                    body=self._format_approval_comment(scorecard),
                    event="COMMENT",
                )
            else:
                await client.post_issue(
                    owner, repo,
                    title=f"Verdict: review required for PR #{number}",
                    body=self._format_issue_body(scorecard),
                )
                scorecard.action_taken = "issue_filed"
        except GitHubClientError as e:
            logger.error("Verdict action layer failed: %s", e)
            scorecard.action_reason += f" [Action layer error: {e}]"

        await self._send({"type": "verdict_complete", "scorecard": scorecard.model_dump()})
        return {"scorecard": scorecard.model_dump(), "status": "completed"}

    @staticmethod
    def _format_approval_comment(scorecard: VerdictScorecard) -> str:
        lines = [
            "**Verdict** — automated pre-review",
            "",
            f"All {len(scorecard.deterministic_checks)} deterministic check(s) passed and all "
            f"{len(scorecard.claim_matches)} claim(s) were verified against the diff.",
            "",
            "| Check | Status |",
            "|---|---|",
        ]
        for c in scorecard.deterministic_checks:
            lines.append(f"| {c.check_name} | {c.status} |")
        return "\n".join(lines)

    @staticmethod
    def _format_issue_body(scorecard: VerdictScorecard) -> str:
        lines = [
            f"Verdict blocked auto-approval for {scorecard.pr_url}.",
            "",
            f"**Reason:** {scorecard.action_reason}",
            "",
            "### Deterministic checks",
        ]
        for c in scorecard.deterministic_checks:
            lines.append(f"- **{c.check_name}**: {c.status} — {c.detail}")
        lines.append("")
        lines.append("### Claim matches")
        for m in scorecard.claim_matches:
            lines.append(f"- \"{m.claim}\" -> **{m.verdict}** (confidence {m.confidence})")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run_verdict(
        self,
        pr_url: str,
        github_token: str | None = None,
        emit: EventEmitter | None = None,
    ) -> VerdictScorecard:
        self._emit = emit
        try:
            initial_state: VerdictState = {
                "pr_url": pr_url,
                "status": "pending",
                "github_token": github_token,
            }
            final_state = await self._graph.ainvoke(initial_state)
            return VerdictScorecard(**final_state["scorecard"])
        finally:
            self._emit = None
