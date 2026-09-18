"""GitHub PR ingestion and the gated action layer.

Only two action types exist on purpose: an approving review comment when
every check gates through clean, or an issue filed for human review when
anything is contested or failed. No generic action framework — one repo,
one PR, two outcomes.
"""

from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

PR_URL_RE = re.compile(
    r"github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)"
)


class GitHubClientError(Exception):
    """Raised when a GitHub API call fails in a way callers must handle explicitly."""


def parse_pr_url(pr_url: str) -> tuple[str, str, int]:
    """Parse a GitHub PR URL into (owner, repo, pr_number)."""
    match = PR_URL_RE.search(pr_url.strip())
    if not match:
        raise GitHubClientError(f"Not a recognizable GitHub PR URL: {pr_url!r}")
    return match.group("owner"), match.group("repo"), int(match.group("number"))


@dataclass
class PRFile:
    filename: str
    status: str
    patch: str | None
    additions: int
    deletions: int


@dataclass
class PRMetadata:
    owner: str
    repo: str
    number: int
    title: str
    body: str
    head_sha: str
    base_sha: str
    head_clone_url: str
    head_ref: str
    files: list[PRFile] = field(default_factory=list)


class GitHubClient:
    """Thin async wrapper around the GitHub REST API v3 used by Verdict."""

    def __init__(self, token: str | None = None) -> None:
        self.token = token or settings.GITHUB_TOKEN
        self.base_url = settings.GITHUB_API_BASE_URL.rstrip("/")
        if not self.token:
            logger.warning(
                "GitHubClient initialized without a token — unauthenticated "
                "requests are heavily rate-limited and cannot write reviews/issues."
            )

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Cognitus-Verdict/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def fetch_pr(self, owner: str, repo: str, pr_number: int) -> PRMetadata:
        """Fetch PR metadata + the list of changed files (GET, read-only)."""
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers()) as client:
            pr_resp = await client.get(
                f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"
            )
            if pr_resp.status_code != 200:
                raise GitHubClientError(
                    f"Failed to fetch PR #{pr_number}: {pr_resp.status_code} {pr_resp.text[:300]}"
                )
            pr_data = pr_resp.json()

            files: list[PRFile] = []
            page = 1
            while True:
                files_resp = await client.get(
                    f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/files",
                    params={"per_page": 100, "page": page},
                )
                if files_resp.status_code != 200:
                    raise GitHubClientError(
                        f"Failed to fetch PR files: {files_resp.status_code} {files_resp.text[:300]}"
                    )
                batch = files_resp.json()
                if not batch:
                    break
                for f in batch:
                    files.append(
                        PRFile(
                            filename=f["filename"],
                            status=f["status"],
                            patch=f.get("patch"),
                            additions=f.get("additions", 0),
                            deletions=f.get("deletions", 0),
                        )
                    )
                if len(batch) < 100:
                    break
                page += 1

            return PRMetadata(
                owner=owner,
                repo=repo,
                number=pr_number,
                title=pr_data.get("title", ""),
                body=pr_data.get("body") or "",
                head_sha=pr_data["head"]["sha"],
                base_sha=pr_data["base"]["sha"],
                head_clone_url=pr_data["head"]["repo"]["clone_url"],
                head_ref=pr_data["head"]["ref"],
                files=files,
            )

    async def fetch_file_content(
        self, owner: str, repo: str, path: str, ref: str
    ) -> str | None:
        """Fetch a single file's full content at a given ref. None if missing/binary."""
        async with httpx.AsyncClient(timeout=15.0, headers=self._headers()) as client:
            resp = await client.get(
                f"{self.base_url}/repos/{owner}/{repo}/contents/{path}",
                params={"ref": ref},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            if data.get("encoding") != "base64" or "content" not in data:
                return None
            try:
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            except Exception:
                return None

    async def post_review(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        event: str = "COMMENT",
    ) -> dict[str, Any]:
        """POST /repos/{owner}/{repo}/pulls/{pr_number}/reviews — used only when
        every deterministic check passed and every claim matched."""
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers()) as client:
            resp = await client.post(
                f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/reviews",
                json={"body": body, "event": event},
            )
            if resp.status_code not in (200, 201):
                raise GitHubClientError(
                    f"Failed to post PR review: {resp.status_code} {resp.text[:300]}"
                )
            return resp.json()

    async def post_issue(
        self, owner: str, repo: str, title: str, body: str
    ) -> dict[str, Any]:
        """POST /repos/{owner}/{repo}/issues — used for contested/failed checks."""
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers()) as client:
            resp = await client.post(
                f"{self.base_url}/repos/{owner}/{repo}/issues",
                json={"title": title, "body": body},
            )
            if resp.status_code not in (200, 201):
                raise GitHubClientError(
                    f"Failed to file issue: {resp.status_code} {resp.text[:300]}"
                )
            return resp.json()
