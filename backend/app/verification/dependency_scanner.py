"""Dependency / CVE scanner.

Diffs the dependency manifest (requirements.txt / package.json) before and
after the PR, then queries the NVD CVE API (same keyless endpoint used by
app/services/enrichment.py's enrich_engineering) for each newly-added
package.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.schemas.verdict_output import DeterministicCheckResult

logger = logging.getLogger(__name__)

NVD_CVE_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0"

MANIFEST_FILENAMES = {"requirements.txt", "package.json"}


def _parse_requirements_txt(content: str) -> set[str]:
    packages: set[str] = set()
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        name = re.split(r"[<>=!~;\[]", line, maxsplit=1)[0].strip()
        if name:
            packages.add(name.lower())
    return packages


def _parse_package_json(content: str) -> set[str]:
    import json

    packages: set[str] = set()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return packages
    for section in ("dependencies", "devDependencies"):
        for name in (data.get(section) or {}).keys():
            packages.add(name.lower())
    return packages


def _parse_manifest(filename: str, content: str) -> set[str]:
    if filename.endswith("requirements.txt"):
        return _parse_requirements_txt(content)
    if filename.endswith("package.json"):
        return _parse_package_json(content)
    return set()


def diff_added_packages(
    manifests_before: dict[str, str], manifests_after: dict[str, str]
) -> set[str]:
    """Return package names present after the PR but not before, across all manifests."""
    added: set[str] = set()
    for filename, after_content in manifests_after.items():
        before_content = manifests_before.get(filename, "")
        after_pkgs = _parse_manifest(filename, after_content)
        before_pkgs = _parse_manifest(filename, before_content)
        added |= (after_pkgs - before_pkgs)
    return added


async def _query_nvd(package_name: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NVD_CVE_BASE,
                params={"keywordSearch": package_name, "resultsPerPage": 5},
                headers={"User-Agent": "Cognitus-Verdict/1.0"},
            )
            if resp.status_code == 200:
                data = resp.json()
                for vuln in data.get("vulnerabilities", [])[:5]:
                    cve = vuln.get("cve", {})
                    descriptions = cve.get("descriptions", [{}])
                    results.append({
                        "package": package_name,
                        "cve_id": cve.get("id", ""),
                        "description": (descriptions[0].get("value", "") if descriptions else "")[:300],
                        "source_url": f"https://nvd.nist.gov/vuln/detail/{cve.get('id', '')}",
                    })
    except Exception as e:
        logger.debug("NVD CVE query failed for package '%s': %s", package_name, e)
    return results


async def scan_dependencies(
    manifests_before: dict[str, str], manifests_after: dict[str, str]
) -> DeterministicCheckResult:
    """Diff dependency manifests and query NVD for CVEs on newly added packages."""
    if not manifests_after:
        return DeterministicCheckResult(
            check_name="cve",
            status="skipped_no_data",
            detail="No dependency manifest (requirements.txt / package.json) changed in this diff.",
        )

    added_packages = diff_added_packages(manifests_before, manifests_after)
    if not added_packages:
        return DeterministicCheckResult(
            check_name="cve",
            status="pass",
            detail="Dependency manifest changed, but no new packages were added.",
        )

    all_findings: list[dict[str, Any]] = []
    for package in sorted(added_packages)[:10]:
        all_findings.extend(await _query_nvd(package))

    if not all_findings:
        return DeterministicCheckResult(
            check_name="cve",
            status="pass",
            detail=f"No known CVEs found for {len(added_packages)} newly added package(s): "
            + ", ".join(sorted(added_packages)),
        )

    detail_lines = [f"{f['package']}: {f['cve_id']} — {f['description']}" for f in all_findings]
    return DeterministicCheckResult(
        check_name="cve",
        status="fail",
        detail=f"{len(all_findings)} known CVE(s) found across new dependencies: "
        + "; ".join(detail_lines[:10]),
        raw_output="\n".join(detail_lines),
    )
