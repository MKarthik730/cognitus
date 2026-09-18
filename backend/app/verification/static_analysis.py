"""Static analysis — bandit (Python) wrapper, run against the diff only.

Writes only the changed Python files (full content at the PR head) to a
scratch directory, runs bandit against that directory, then keeps only the
findings that land on lines actually touched by the diff. No interpretation
of results happens here — this module passes through what bandit found.
"""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path

from app.schemas.verdict_output import DeterministicCheckResult
from app.verification.diff_utils import added_line_numbers as _changed_line_numbers

logger = logging.getLogger(__name__)

BANDIT_TIMEOUT_SECONDS = 60


def run_bandit(files: dict[str, str], diffs: dict[str, str]) -> DeterministicCheckResult:
    """Run bandit against changed Python files, filtered to diff lines.

    Args:
        files: filename -> full file content at the PR head commit.
        diffs: filename -> unified diff text (patch) for that file.
    """
    py_files = {fn: content for fn, content in files.items() if fn.endswith(".py")}
    if not py_files:
        return DeterministicCheckResult(
            check_name="static_analysis",
            status="skipped_no_data",
            detail="No Python files changed in this diff.",
        )

    with tempfile.TemporaryDirectory(prefix="verdict_bandit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        path_map: dict[str, str] = {}
        for filename, content in py_files.items():
            dest = tmp_path / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(content, encoding="utf-8", errors="replace")
            path_map[str(dest.resolve())] = filename

        try:
            proc = subprocess.run(
                ["bandit", "-r", str(tmp_path), "-f", "json"],
                capture_output=True,
                text=True,
                timeout=BANDIT_TIMEOUT_SECONDS,
            )
        except FileNotFoundError:
            return DeterministicCheckResult(
                check_name="static_analysis",
                status="error",
                detail="bandit is not installed in this environment.",
            )
        except subprocess.TimeoutExpired:
            return DeterministicCheckResult(
                check_name="static_analysis",
                status="error",
                detail=f"bandit timed out after {BANDIT_TIMEOUT_SECONDS}s.",
            )

        raw_stdout = proc.stdout
        try:
            report = json.loads(raw_stdout) if raw_stdout else {}
        except json.JSONDecodeError:
            return DeterministicCheckResult(
                check_name="static_analysis",
                status="error",
                detail="Failed to parse bandit output.",
                raw_output=(raw_stdout + proc.stderr)[:4000],
            )

        all_results = report.get("results", [])
        diff_only_findings = []
        for result in all_results:
            abs_filename = str(Path(result.get("filename", "")).resolve())
            original_name = path_map.get(abs_filename)
            if not original_name:
                continue
            line_no = result.get("line_number")
            changed_lines = _changed_line_numbers(diffs.get(original_name, ""))
            if line_no in changed_lines or not changed_lines:
                diff_only_findings.append(
                    f"{original_name}:{line_no} [{result.get('issue_severity')}] "
                    f"{result.get('test_id')} — {result.get('issue_text')}"
                )

        if not diff_only_findings:
            return DeterministicCheckResult(
                check_name="static_analysis",
                status="pass",
                detail="bandit found no issues on the changed lines.",
                raw_output=raw_stdout[:4000] if raw_stdout else None,
            )

        return DeterministicCheckResult(
            check_name="static_analysis",
            status="fail",
            detail=f"bandit flagged {len(diff_only_findings)} issue(s) on changed lines: "
            + "; ".join(diff_only_findings[:10]),
            raw_output=raw_stdout[:4000] if raw_stdout else None,
        )
