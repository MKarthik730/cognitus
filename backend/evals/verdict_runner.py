"""Eval harness for Verdict's own gating logic.

Unlike evals/runner.py (which runs the full LLM council pipeline), these
fixtures exercise app.agents.verdict_synthesizer.VerdictSynthesizer directly
with fixed DeterministicCheckResult / ClaimMatchResult inputs — no LLM, no
Docker required. This is deliberate: the one claim Verdict makes that must
be provable by construction, not by anecdote, is "auto_approved never fires
unless every check passed and every claim matched." That's exactly what
these fixtures check.

Usage:
    python -m backend.evals.verdict_runner --all
    python -m backend.evals.verdict_runner --fixture deceptive_pr
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agents.verdict_synthesizer import VerdictSynthesizer  # noqa: E402
from app.schemas.verdict_output import (  # noqa: E402
    ClaimMatchResult,
    DeterministicCheckResult,
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

    if not all(r.overall_pass for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
