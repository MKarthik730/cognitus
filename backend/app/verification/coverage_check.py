"""Coverage of changed lines — intersects executed lines with diff lines.

This is a pure function over data the sandbox runner already produced
(per-file executed line numbers from `coverage json`) — it makes no
assumptions about how that data was collected. It exists specifically to
make "tests pass" meaningfully different from "tests pass AND this code
was actually exercised": a changed file with 0% coverage on its new lines
is flagged explicitly rather than silently counted as fine.
"""

from __future__ import annotations

from app.schemas.verdict_output import DeterministicCheckResult
from app.verification.diff_utils import added_line_numbers


def compute_diff_coverage(
    covered_lines_by_file: dict[str, set[int]],
    diffs: dict[str, str],
) -> DeterministicCheckResult:
    """Args:
        covered_lines_by_file: filename -> set of line numbers actually executed
            by the test run (from `coverage json`'s per-file `executed_lines`).
        diffs: filename -> unified diff text (patch) for that file.
    """
    if not diffs:
        return DeterministicCheckResult(
            check_name="coverage",
            status="skipped_no_data",
            detail="No diff files provided.",
        )

    if not covered_lines_by_file:
        return DeterministicCheckResult(
            check_name="coverage",
            status="skipped_no_data",
            detail="No coverage data available (tests may not have run).",
        )

    uncovered_by_file: dict[str, list[int]] = {}
    total_changed = 0
    total_covered = 0

    for filename, diff_text in diffs.items():
        changed = added_line_numbers(diff_text)
        if not changed:
            continue
        covered = covered_lines_by_file.get(filename, set())
        total_changed += len(changed)
        total_covered += len(changed & covered)
        missing = sorted(changed - covered)
        if missing:
            uncovered_by_file[filename] = missing

    if total_changed == 0:
        return DeterministicCheckResult(
            check_name="coverage",
            status="skipped_no_data",
            detail="No coverable (added) lines found in the diff.",
        )

    coverage_pct = round((total_covered / total_changed) * 100, 1)

    if not uncovered_by_file:
        return DeterministicCheckResult(
            check_name="coverage",
            status="pass",
            detail=f"100% of changed lines ({total_changed}) were exercised by the test run.",
        )

    detail_parts = [
        f"{filename}: lines {', '.join(str(l) for l in lines[:15])}"
        for filename, lines in uncovered_by_file.items()
    ]
    return DeterministicCheckResult(
        check_name="coverage",
        status="fail",
        detail=(
            f"Only {coverage_pct}% of changed lines ({total_covered}/{total_changed}) "
            f"were exercised. Uncovered: " + "; ".join(detail_parts)
        ),
    )
