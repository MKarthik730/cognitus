"""Eval harness runner.

Loads fixtures, runs each through the full Cognitus pipeline,
scores results against expected outcomes, and prints a formatted table.

Usage:
    python -m backend.evals.runner --all
    python -m backend.evals.runner --fixture medical_diagnosis
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.WARNING)

from app.graph.council_graph import CouncilGraph  # noqa: E402
from app.services.hf_service import HFService  # noqa: E402
from app.schemas.node_output import confidence_to_level  # noqa: E402


FIXTURES_PATH = Path(__file__).parent / "fixtures.json"


class EvalResult:
    """Results from a single eval run."""

    def __init__(self, fixture_name: str) -> None:
        self.fixture_name = fixture_name
        self.consensus_score: float = 0.0
        self.consensus_pass: bool = False
        self.findings_present: list[str] = []
        self.findings_missing: list[str] = []
        self.forbidden_found: list[str] = []
        self.forbidden_pass: bool = True
        self.min_confidence_pass: bool = False
        self.synthesis_keywords_found: list[str] = []
        self.synthesis_keywords_missing: list[str] = []
        self.synthesis_pass: bool = False
        self.overall_pass: bool = False
        self.error: str | None = None

    @property
    def pass_rate(self) -> float:
        checks = [self.consensus_pass, self.forbidden_pass, self.min_confidence_pass, self.synthesis_pass]
        if not checks:
            return 0.0
        return sum(1 for c in checks if c) / len(checks)


async def run_eval(fixture: dict[str, Any]) -> EvalResult:
    """Run a single eval fixture through the pipeline."""

    result = EvalResult(fixture_name=fixture["name"])
    expected = fixture["expected"]

    try:
        hf_service = HFService()
        graph = CouncilGraph(hf_service)
        situation = "\n\n".join(fixture.get("documents", []))
        question = fixture.get("question", "")
        full_situation = f"Question: {question}\n\nSituation:\n{situation}" if question else situation

        council_result = await graph.run(
            situation=full_situation,
            session_id=f"eval-{fixture['name']}",
            user_id=0,
        )

        # Extract results
        synthesis = council_result.get("synthesis", {})
        cross_check = council_result.get("cross_check", {})
        experts = council_result.get("experts", {})

        result.consensus_score = synthesis.get("consensus_score", cross_check.get("consensus_score", 0.0))

        # 1. Consensus check
        min_consensus = expected.get("min_consensus", 0.5)
        result.consensus_pass = result.consensus_score >= min_consensus

        # 2. Required findings check
        required_findings = expected.get("required_findings", [])
        all_text = ""
        for exp_data in experts.values():
            all_text += f"{exp_data.get('analysis', '')} {exp_data.get('position', '')} {' '.join(exp_data.get('key_findings', []))} "
        all_text += f"{synthesis.get('verdict', '')} {synthesis.get('reasoning', '')}"

        all_text_lower = all_text.lower()
        for finding in required_findings:
            if finding.lower() in all_text_lower:
                result.findings_present.append(finding)
            else:
                result.findings_missing.append(finding)

        # 3. Forbidden content check
        forbidden_content = expected.get("forbidden_content", [])
        for forbidden in forbidden_content:
            if forbidden.lower() in all_text_lower:
                result.forbidden_found.append(forbidden)
                result.forbidden_pass = False

        # 4. Minimum node confidence check
        min_conf = expected.get("min_node_confidence", 0.3)
        if experts:
            conf_values = []
            for exp_data in experts.values():
                conf_level = exp_data.get("confidence", "medium")
                conf_map = {"low": 0.2, "medium": 0.5, "high": 0.8}
                conf_values.append(conf_map.get(conf_level, 0.5))
            result.min_confidence_pass = min(conf_values) >= min_conf
        else:
            result.min_confidence_pass = False

        # 5. Synthesis keyword check
        synth_must = expected.get("synthesis_must_contain", [])
        synth_text = f"{synthesis.get('verdict', '')} {synthesis.get('reasoning', '')}".lower()
        for keyword in synth_must:
            if keyword.lower() in synth_text:
                result.synthesis_keywords_found.append(keyword)
            else:
                result.synthesis_keywords_missing.append(keyword)
        result.synthesis_pass = len(result.synthesis_keywords_missing) == 0

        # Overall
        checks = [result.consensus_pass, result.forbidden_pass, result.min_confidence_pass, result.synthesis_pass]
        result.overall_pass = all(checks)

    except Exception as e:
        result.error = str(e)
        result.overall_pass = False

    return result


def print_results_table(results: list[EvalResult]) -> None:
    """Print a formatted results table."""
    print()
    print("=" * 90)
    print(f"{'EVAL RESULTS':^90}")
    print("=" * 90)
    print(f"{'Fixture':<25} {'Consensus':<12} {'Findings':<12} {'Forbidden':<12} {'Keywords':<12} {'Overall':<12}")
    print("-" * 90)

    for r in results:
        consensus_str = f"{r.consensus_score:.0%}" if r.consensus_pass else f"{r.consensus_score:.0%} ❌"
        findings_str = f"{len(r.findings_present)}/{len(r.findings_present) + len(r.findings_missing)}"
        forbidden_str = "✅" if r.forbidden_pass else f"⚠️ {len(r.forbidden_found)}"
        keywords_str = f"{len(r.synthesis_keywords_found)}/{len(r.synthesis_keywords_found) + len(r.synthesis_keywords_missing)}"
        overall_str = "✅ PASS" if r.overall_pass else "❌ FAIL"
        if r.error:
            overall_str = "💥 ERROR"

        print(f"{r.fixture_name:<25} {consensus_str:<12} {findings_str:<12} {forbidden_str:<12} {keywords_str:<12} {overall_str:<12}")

    print("-" * 90)
    passed = sum(1 for r in results if r.overall_pass)
    print(f"Total: {len(results)} | Passed: {passed} | Failed: {len(results) - passed}")
    print("=" * 90)
    print()


async def run_all_evals() -> list[EvalResult]:
    """Load fixtures and run all evals."""
    if not FIXTURES_PATH.exists():
        print(f"Fixtures file not found: {FIXTURES_PATH}")
        return []

    with open(FIXTURES_PATH) as f:
        fixtures = json.load(f)

    results: list[EvalResult] = []
    for fixture in fixtures:
        print(f"Running eval: {fixture['name']}...")
        result = await run_eval(fixture)
        results.append(result)

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Cognitus Eval Harness")
    parser.add_argument("--all", action="store_true", help="Run all fixtures")
    parser.add_argument("--fixture", type=str, help="Run a single fixture by name")
    args = parser.parse_args()

    if not args.all and not args.fixture:
        parser.print_help()
        return

    results = asyncio.run(run_all_evals())

    if args.fixture:
        results = [r for r in results if r.fixture_name == args.fixture]
        if not results:
            print(f"Fixture '{args.fixture}' not found")
            return

    print_results_table(results)

    # Exit with non-zero code if any eval failed
    if not all(r.overall_pass for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
