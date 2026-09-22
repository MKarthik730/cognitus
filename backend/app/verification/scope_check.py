"""Unintended-scope detection — flags changes to sensitive, high-blast-radius
files that the PR's own title/description never mentions.

`verdict_synthesizer.py` treats *any* non-empty `unintended_scope` result as
a hard block on auto-approval, so this is deliberately conservative: a fixed,
high-precision list of file patterns (CI config, container/deploy config,
dependency lockfiles, infra-as-code, env/secrets files) rather than a broad
heuristic that would generate false positives and block legitimate PRs.
"""

from __future__ import annotations

import re

# (pattern, human-readable label). Matched against the full repo-relative
# path; `re.search` so a match anywhere in the path (e.g. nested directories)
# still counts.
_SENSITIVE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(^|/)\.github/workflows/", "CI/CD workflow"),
    (r"(^|/)\.gitlab-ci\.ya?ml$", "CI/CD workflow"),
    (r"(^|/)\.circleci/", "CI/CD workflow"),
    (r"(^|/)Dockerfile(\.[^/]+)?$", "container build config"),
    (r"(^|/)docker-compose(\.[^/]+)?\.ya?ml$", "container orchestration config"),
    (r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock)$", "dependency lockfile"),
    (r"(^|/)\.env(\.[^/]+)?$", "environment/secrets file"),
    (r"(^|/)[^/]+\.tf$", "infrastructure-as-code config"),
)


def detect_unintended_scope(
    pr_title: str, pr_body: str, changed_files: list[str],
) -> list[str]:
    """Flag changed files matching sensitive patterns the PR text never mentions.

    A file only counts as "mentioned" if its basename or full path appears
    (case-insensitively) in the PR title or description — the PR author
    doesn't need to justify it in detail, just acknowledge touching it.
    """
    stated_intent = f"{pr_title}\n{pr_body}".lower()
    flagged: list[str] = []

    for filename in changed_files:
        for pattern, label in _SENSITIVE_PATTERNS:
            if not re.search(pattern, filename, flags=re.IGNORECASE):
                continue
            basename = filename.rsplit("/", 1)[-1]
            mentioned = basename.lower() in stated_intent or filename.lower() in stated_intent
            if not mentioned:
                flagged.append(
                    f"{filename} ({label}) was modified but never mentioned in the "
                    f"PR title/description."
                )
            break  # first matching pattern wins — don't double-flag one file

    return flagged
