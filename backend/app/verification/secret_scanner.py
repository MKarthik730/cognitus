"""Secret scanner — regex/entropy-based detection of hardcoded credentials.

Ported from Void's pre-push guardrail. Runs only against added diff lines
(lines starting with "+", excluding the "+++" file header) — never the
whole repo.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.schemas.verdict_output import DeterministicCheckResult
from app.verification.diff_utils import added_lines as _added_lines

# High-confidence, provider-specific patterns first (near-zero false positive
# rate), then a generic fallback for anything that looks like an assigned
# secret with high entropy.
SECRET_PATTERNS: list[tuple[str, str]] = [
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key ID"),
    (r"ASIA[0-9A-Z]{16}", "AWS Temporary Access Key ID"),
    (r"(?i)aws(.{0,20})?secret(.{0,20})?['\"][0-9a-zA-Z/+]{40}['\"]", "AWS Secret Access Key"),
    (r"ghp_[0-9A-Za-z]{36}", "GitHub Personal Access Token"),
    (r"github_pat_[0-9A-Za-z_]{22,}", "GitHub Fine-Grained PAT"),
    (r"gho_[0-9A-Za-z]{36}", "GitHub OAuth Token"),
    (r"xox[baprs]-[0-9A-Za-z-]{10,}", "Slack Token"),
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI-style Secret Key"),
    (r"sk-ant-[A-Za-z0-9\-_]{20,}", "Anthropic API Key"),
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API Key"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "Private Key Block"),
    (r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "JWT-like Token"),
    (r"postgres(?:ql)?://[^:\s]+:[^@\s]+@", "Postgres Connection String with Credentials"),
    (r"mongodb(?:\+srv)?://[^:\s]+:[^@\s]+@", "MongoDB Connection String with Credentials"),
]

# Generic "SOMETHING_KEY = '...'" assignment pattern, gated by entropy so it
# doesn't flag every constant string in the diff.
GENERIC_ASSIGNMENT_RE = re.compile(
    r"""(?i)\b([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*['"]([^'"]{12,})['"]"""
)

ENTROPY_THRESHOLD = 3.5
MIN_SECRET_LENGTH = 16


def _shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in freq.values())


@dataclass
class SecretFinding:
    line_number: int
    reason: str
    snippet: str


def _redact(secret: str) -> str:
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}{'*' * (len(secret) - 8)}{secret[-4:]}"


def find_secrets(diff_text: str) -> list[SecretFinding]:
    """Scan added diff lines for hardcoded secrets. Pure function, no I/O."""
    findings: list[SecretFinding] = []

    for line_no, content in _added_lines(diff_text):
        for pattern, reason in SECRET_PATTERNS:
            match = re.search(pattern, content)
            if match:
                findings.append(
                    SecretFinding(line_no, reason, _redact(match.group(0)))
                )
                break
        else:
            generic = GENERIC_ASSIGNMENT_RE.search(content)
            if generic:
                candidate = generic.group(2)
                if len(candidate) >= MIN_SECRET_LENGTH and _shannon_entropy(candidate) >= ENTROPY_THRESHOLD:
                    findings.append(
                        SecretFinding(
                            line_no,
                            f"High-entropy value assigned to '{generic.group(1)}'",
                            _redact(candidate),
                        )
                    )

    return findings


def scan_diff_for_secrets(diff_text: str) -> DeterministicCheckResult:
    """Run the secret scanner and produce a DeterministicCheckResult."""
    if not diff_text.strip():
        return DeterministicCheckResult(
            check_name="secrets",
            status="skipped_no_data",
            detail="No diff content to scan.",
        )

    findings = find_secrets(diff_text)
    if not findings:
        return DeterministicCheckResult(
            check_name="secrets",
            status="pass",
            detail="No hardcoded secrets detected in added lines.",
        )

    detail_lines = [
        f"line {f.line_number}: {f.reason} ({f.snippet})" for f in findings
    ]
    return DeterministicCheckResult(
        check_name="secrets",
        status="fail",
        detail=f"{len(findings)} potential secret(s) found: " + "; ".join(detail_lines[:10]),
        raw_output="\n".join(detail_lines),
    )
