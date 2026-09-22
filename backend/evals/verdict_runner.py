"""Eval harness for Verdict's own gating logic.

Unlike evals/runner.py (which runs the full LLM council pipeline), these
fixtures exercise app.agents.verdict_synthesizer.VerdictSynthesizer directly
with fixed DeterministicCheckResult / ClaimMatchResult inputs — no LLM, no
Docker required. This is deliberate: the one claim Verdict makes that must
be provable by construction, not by anecdote, is "auto_approved never fires
unless every check passed and every claim matched." That's exactly what
these fixtures check.

`run_action_layer_evals()` covers a second, related invariant that the
synthesizer alone can't prove: a *failed* GitHub write must never be
reported as the decision it failed to carry out (e.g. a broken token during
`post_review` must not leave the scorecard claiming "auto_approved"). It
drives VerdictGraph._run_action_layer directly against a GitHubClient double
whose writes always fail — still no real network/Docker calls.

Usage:
    python -m backend.evals.verdict_runner --all
    python -m backend.evals.verdict_runner --fixture deceptive_pr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agents.verdict_synthesizer import VerdictSynthesizer  # noqa: E402
from app.graph.verdict_graph import VerdictGraph  # noqa: E402
from app.ingestion.github_client import GitHubClientError  # noqa: E402
from app.schemas.verdict_output import (  # noqa: E402
    ActionTaken,
    ClaimMatchResult,
    DeterministicCheckResult,
    VerdictScorecard,
)

FIXTURES_PATH = Path(__file__).parent / "verdict_fixtures.json"


class VerdictEvalResult:
    def __init__(self, fixture_name: str) -> None:
        self.fixture_name = fixture_name
        self.expected_gate: str = ""
        self.actual_gate: str = ""
        self.action_reason: str = ""
        self.overall_pass: bool = False
        self.error: str | None = None


def run_verdict_eval(fixture: dict) -> VerdictEvalResult:
    result = VerdictEvalResult(fixture["name"])
    result.expected_gate = fixture["expected_gate"]

    try:
        checks = [DeterministicCheckResult(**c) for c in fixture["deterministic_checks"]]
        matches = [ClaimMatchResult(**m) for m in fixture["claim_matches"]]

        scorecard = VerdictSynthesizer().synthesize(
            pr_url=fixture["pr_url"],
            deterministic_checks=checks,
            opinion_findings=[],
            claim_matches=matches,
        )

        result.actual_gate = scorecard.action_taken
        result.action_reason = scorecard.action_reason
        result.overall_pass = result.actual_gate == result.expected_gate
    except Exception as e:
        result.error = str(e)
        result.overall_pass = False

    return result


class ActionLayerEvalResult:
    def __init__(self, name: str) -> None:
        self.name = name
        self.overall_pass = False
        self.actual_action: str = ""
        self.error: str | None = None


def _make_scorecard(action_taken: ActionTaken) -> VerdictScorecard:
    return VerdictScorecard(
        pr_url="https://github.com/example/demo-repo/pull/1",
        deterministic_checks=[],
        opinion_findings=[],
        claim_matches=[],
        unintended_scope=[],
        action_taken=action_taken,
        action_reason="eval fixture — gate decision under test",
    )


async def _drive_action_layer_with_failing_writes(action_taken: ActionTaken) -> VerdictScorecard:
    """Run VerdictGraph._run_action_layer with a GitHubClient double whose
    post_review/post_issue always raise, and return the resulting scorecard."""
    graph = VerdictGraph.__new__(VerdictGraph)  # skip __init__ — no HFService needed
    graph._emit = None

    state = {
        "scorecard": _make_scorecard(action_taken).model_dump(),
        "pr_metadata": {"owner": "example", "repo": "demo-repo", "number": 1},
        "github_token": "fake-token",
    }

    fake_client = MagicMock()
    fake_client.post_review = AsyncMock(side_effect=GitHubClientError("simulated 401 Unauthorized"))
    fake_client.post_issue = AsyncMock(side_effect=GitHubClientError("simulated 401 Unauthorized"))

    with patch("app.graph.verdict_graph.GitHubClient", return_value=fake_client):
        result = await graph._run_action_layer(state)

    return VerdictScorecard(**result["scorecard"])


def run_action_layer_evals() -> list[ActionLayerEvalResult]:
    """Prove a failed GitHub write is never mistaken for a successful one —
    the specific gap a prior audit found: a broken post_review call used to
    leave action_taken="auto_approved" even though nothing was posted."""
    scenarios: list[ActionTaken] = ["auto_approved", "blocked_for_review"]
    results: list[ActionLayerEvalResult] = []

    for gate_decision in scenarios:
        r = ActionLayerEvalResult(f"action_failed_when_{gate_decision}_write_fails")
        try:
            scorecard = asyncio.run(_drive_action_layer_with_failing_writes(gate_decision))
            r.actual_action = scorecard.action_taken
            r.overall_pass = scorecard.action_taken == "action_failed"
        except Exception as e:
            r.error = str(e)
        results.append(r)

    return results


def print_results_table(results: list[VerdictEvalResult]) -> None:
    print()
    print("=" * 90)
    print(f"{'VERDICT EVAL RESULTS':^90}")
    print("=" * 90)
    print(f"{'Fixture':<25} {'Expected':<20} {'Actual':<20} {'Overall':<12}")
    print("-" * 90)
    for r in results:
        overall_str = "PASS" if r.overall_pass else "FAIL"
        if r.error:
            overall_str = "ERROR"
        print(f"{r.fixture_name:<25} {r.expected_gate:<20} {r.actual_gate:<20} {overall_str:<12}")
        if not r.overall_pass:
            print(f"  -> {r.error or r.action_reason}")
    print("-" * 90)
    passed = sum(1 for r in results if r.overall_pass)
    print(f"Total: {len(results)} | Passed: {passed} | Failed: {len(results) - passed}")
    print("=" * 90)
    print()


def print_action_layer_results(results: list[ActionLayerEvalResult]) -> None:
    print("=" * 90)
    print(f"{'ACTION LAYER EVAL RESULTS':^90}")
    print("=" * 90)
    print(f"{'Scenario':<45} {'Expected':<20} {'Actual':<12} {'Overall':<12}")
    print("-" * 90)
    for r in results:
        overall_str = "ERROR" if r.error else ("PASS" if r.overall_pass else "FAIL")
        print(f"{r.name:<45} {'action_failed':<20} {r.actual_action:<12} {overall_str:<12}")
        if r.error:
            print(f"  -> {r.error}")
    print("-" * 90)
    passed = sum(1 for r in results if r.overall_pass)
    print(f"Total: {len(results)} | Passed: {passed} | Failed: {len(results) - passed}")
    print("=" * 90)
    print()


def run_all_evals() -> list[VerdictEvalResult]:
    if not FIXTURES_PATH.exists():
        print(f"Fixtures file not found: {FIXTURES_PATH}")
        return []
    with open(FIXTURES_PATH) as f:
        fixtures = json.load(f)
    return [run_verdict_eval(fixture) for fixture in fixtures]


def main() -> None:
    parser = argparse.ArgumentParser(description="Verdict Eval Harness")
    parser.add_argument("--all", action="store_true", help="Run all fixtures")
    parser.add_argument("--fixture", type=str, help="Run a single fixture by name")
    parser.add_argument(
        "--skip-action-layer", action="store_true",
        help="Skip the action-layer write-failure regression checks",
    )
    args = parser.parse_args()

    if not args.all and not args.fixture:
        parser.print_help()
        return

    results = run_all_evals()

    if args.fixture:
        results = [r for r in results if r.fixture_name == args.fixture]
        if not results:
            print(f"Fixture '{args.fixture}' not found")
            return

    print_results_table(results)
    all_passed = all(r.overall_pass for r in results)

    action_results: list[ActionLayerEvalResult] = []
    if args.all and not args.skip_action_layer:
        action_results = run_action_layer_evals()
        print_action_layer_results(action_results)
        all_passed = all_passed and all(r.overall_pass for r in action_results)

    if not all_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
