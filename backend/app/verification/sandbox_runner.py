"""Sandbox test execution — spins up a short-lived Docker container, clones
the PR's head commit into it, detects the test command, and runs the real
test suite. This is the deterministic layer's core check: it never treats
"no test suite found" as "tests passed" (see `skipped_no_data`).

Requires a reachable Docker daemon and the `docker` Python package
(`pip install docker`). Callers should treat any Docker/daemon failure as
"the check errored", not "the tests failed" — those are different facts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Literal

from app.schemas.verdict_output import DeterministicCheckResult

logger = logging.getLogger(__name__)

TEST_OUTPUT_START = "___VERDICT_TEST_OUTPUT_START___"
TEST_OUTPUT_END = "___VERDICT_TEST_OUTPUT_END___"
COVERAGE_START = "___VERDICT_COVERAGE_START___"
COVERAGE_END = "___VERDICT_COVERAGE_END___"
NO_TESTS_MARKER = "___VERDICT_NO_TESTS_FOUND___"
EXIT_CODE_MARKER = "___VERDICT_EXIT_CODE___"

DEFAULT_TIMEOUT_SECONDS = 300

Runtime = Literal["python", "node", "unknown"]


def detect_runtime(filenames: list[str]) -> Runtime:
    """Best-effort runtime detection from the repo's changed + root file list."""
    lowered = {f.lower() for f in filenames}
    has_node = any(f == "package.json" or f.endswith("/package.json") for f in lowered)
    has_python = any(
        f in ("requirements.txt", "pyproject.toml", "setup.py", "pytest.ini")
        or f.endswith(("/requirements.txt", "/pyproject.toml", "/setup.py", "/pytest.ini"))
        or f.endswith(".py")
        for f in lowered
    )
    if has_node and not has_python:
        return "node"
    if has_python:
        return "python"
    if has_node:
        return "node"
    return "unknown"


_PYTHON_SCRIPT = r"""
set -e
git clone --quiet --depth 50 "{clone_url}" /repo
cd /repo && git checkout --quiet {head_sha}
pip install --quiet --no-cache-dir -r requirements.txt 2>/dev/null || true
pip install --quiet --no-cache-dir pytest coverage
if find . -name 'test_*.py' -o -name '*_test.py' | grep -q .; then
    coverage run -m pytest -q --tb=short > /tmp/test_output.txt 2>&1 && echo 0 > /tmp/exit_code || echo $? > /tmp/exit_code
    coverage json -o /tmp/coverage.json 2>/dev/null || echo '{{}}' > /tmp/coverage.json
else
    echo "%(no_tests)s" > /tmp/test_output.txt
    echo '{{}}' > /tmp/coverage.json
fi
echo "%(out_start)s"
cat /tmp/test_output.txt
echo "%(out_end)s"
echo "%(cov_start)s"
cat /tmp/coverage.json
echo "%(cov_end)s"
""" % {
    "no_tests": NO_TESTS_MARKER,
    "out_start": TEST_OUTPUT_START,
    "out_end": TEST_OUTPUT_END,
    "cov_start": COVERAGE_START,
    "cov_end": COVERAGE_END,
}

_NODE_SCRIPT = r"""
set -e
git clone --quiet --depth 50 "{clone_url}" /repo
cd /repo && git checkout --quiet {head_sha}
npm install --silent 2>/dev/null || true
if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.test ? 0 : 1)" 2>/dev/null; then
    npm test --silent > /tmp/test_output.txt 2>&1 && echo 0 > /tmp/exit_code || echo $? > /tmp/exit_code
else
    echo "%(no_tests)s" > /tmp/test_output.txt
fi
echo '{{}}' > /tmp/coverage.json
echo "%(out_start)s"
cat /tmp/test_output.txt
echo "%(out_end)s"
echo "%(cov_start)s"
cat /tmp/coverage.json
echo "%(cov_end)s"
""" % {
    "no_tests": NO_TESTS_MARKER,
    "out_start": TEST_OUTPUT_START,
    "out_end": TEST_OUTPUT_END,
    "cov_start": COVERAGE_START,
    "cov_end": COVERAGE_END,
}

_IMAGE_BY_RUNTIME = {
    "python": "python:3.11-slim",
    "node": "node:20-slim",
}


def _extract_section(logs: str, start_marker: str, end_marker: str) -> str:
    start = logs.find(start_marker)
    end = logs.find(end_marker)
    if start == -1 or end == -1 or end < start:
        return ""
    return logs[start + len(start_marker) : end].strip()


def _parse_pytest_summary(output: str) -> tuple[int, int, int] | None:
    """Returns (passed, failed, errored) from pytest's summary line, if found."""
    passed = int(m.group(1)) if (m := re.search(r"(\d+) passed", output)) else 0
    failed = int(m.group(1)) if (m := re.search(r"(\d+) failed", output)) else 0
    errored = int(m.group(1)) if (m := re.search(r"(\d+) error", output)) else 0
    if passed or failed or errored:
        return passed, failed, errored
    return None


def _parse_node_summary(output: str) -> tuple[int, int] | None:
    """Returns (passed, failed) from jest/mocha-style summary output, if found."""
    jest = re.search(r"Tests:\s+(?:(\d+) failed, )?(\d+) passed", output)
    if jest:
        failed = int(jest.group(1)) if jest.group(1) else 0
        passed = int(jest.group(2))
        return passed, failed
    mocha_passing = re.search(r"(\d+) passing", output)
    mocha_failing = re.search(r"(\d+) failing", output)
    if mocha_passing or mocha_failing:
        return (
            int(mocha_passing.group(1)) if mocha_passing else 0,
            int(mocha_failing.group(1)) if mocha_failing else 0,
        )
    return None


def _run_container_sync(image: str, script: str, timeout: int) -> str:
    """Blocking Docker call — run under asyncio.to_thread from async callers."""
    import docker  # imported lazily so the rest of the app works without docker-py installed

    client = docker.from_env()
    container = None
    try:
        container = client.containers.run(
            image,
            ["bash", "-c", script],
            detach=True,
            network_mode="bridge",
            mem_limit="1g",
            nano_cpus=2_000_000_000,
        )
        result = container.wait(timeout=timeout)
        logs = container.logs().decode("utf-8", errors="replace")
        if result.get("StatusCode") not in (0, None):
            logs += f"\n[container exited with status {result.get('StatusCode')}]"
        return logs
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception:
                pass


async def run_sandbox_tests(
    clone_url: str,
    head_sha: str,
    changed_and_root_files: list[str],
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[DeterministicCheckResult, dict[str, set[int]]]:
    """Run the real test suite for a PR inside a short-lived Docker container.

    Returns (DeterministicCheckResult, covered_lines_by_file) — the latter is
    consumed by coverage_check.py and is empty for non-Python runtimes or
    when tests didn't run.
    """
    runtime = detect_runtime(changed_and_root_files)
    if runtime == "unknown":
        return (
            DeterministicCheckResult(
                check_name="tests",
                status="skipped_no_data",
                detail="Could not detect a Python or Node test runner for this repo.",
            ),
            {},
        )

    image = _IMAGE_BY_RUNTIME[runtime]
    script_template = _PYTHON_SCRIPT if runtime == "python" else _NODE_SCRIPT
    script = script_template.format(clone_url=clone_url, head_sha=head_sha)

    try:
        logs = await asyncio.to_thread(_run_container_sync, image, script, timeout)
    except ImportError:
        return (
            DeterministicCheckResult(
                check_name="tests",
                status="error",
                detail="The 'docker' Python package is not installed in this environment.",
            ),
            {},
        )
    except Exception as e:
        logger.error("Sandbox execution failed: %s", e)
        return (
            DeterministicCheckResult(
                check_name="tests",
                status="error",
                detail=f"Sandbox execution failed: {e}",
            ),
            {},
        )

    test_output = _extract_section(logs, TEST_OUTPUT_START, TEST_OUTPUT_END)
    coverage_raw = _extract_section(logs, COVERAGE_START, COVERAGE_END)

    if NO_TESTS_MARKER in test_output or not test_output:
        return (
            DeterministicCheckResult(
                check_name="tests",
                status="skipped_no_data",
                detail="No test suite found in this repository.",
                raw_output=logs[:4000],
            ),
            {},
        )

    covered_lines_by_file: dict[str, set[int]] = {}
    try:
        coverage_data: dict[str, Any] = json.loads(coverage_raw) if coverage_raw else {}
        for filename, file_data in coverage_data.get("files", {}).items():
            covered_lines_by_file[filename] = set(file_data.get("executed_lines", []))
    except json.JSONDecodeError:
        pass

    if runtime == "python":
        summary = _parse_pytest_summary(test_output)
        if summary:
            passed, failed, errored = summary
            status = "pass" if failed == 0 and errored == 0 else "fail"
            detail = f"{passed} passed, {failed} failed, {errored} errored."
        else:
            status = "fail" if "FAILED" in test_output or "ERROR" in test_output else "pass"
            detail = "Could not parse pytest summary; inferred from output content."
    else:
        summary = _parse_node_summary(test_output)
        if summary:
            passed, failed = summary
            status = "pass" if failed == 0 else "fail"
            detail = f"{passed} passed, {failed} failed."
        else:
            status = "pass" if "fail" not in test_output.lower() else "fail"
            detail = "Could not parse test summary; inferred from output content."

    return (
        DeterministicCheckResult(
            check_name="tests",
            status=status,
            detail=detail,
            raw_output=test_output[:4000],
        ),
        covered_lines_by_file,
    )
