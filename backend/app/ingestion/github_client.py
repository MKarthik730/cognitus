"""GitHub PR ingestion and the gated action layer.

Only two action types exist on purpose: an approving review comment when
every check gates through clean, or an issue filed for human review when
anything is contested or failed. No generic action framework — one repo,
one PR, two outcomes.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

PR_URL_RE = re.compile(
    r"github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)"
)

# Transient-failure handling: retried automatically, capped and bounded so a
# stuck GitHub API call can't hang a Verdict run indefinitely.
_MAX_ATTEMPTS = 4
_BASE_BACKOFF_SECONDS = 1.0
_MAX_BACKOFF_SECONDS = 60.0
_RETRYABLE_STATUS_CODES = {500, 502, 503, 504}


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

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        *,
        idempotent: bool = True,
        **kwargs: Any,
    ) -> httpx.Response:
        """Issue one HTTP call with retry/backoff for transient failures.

        Retries 5xx responses with exponential backoff and honors both
        GitHub rate-limit signals: the primary limit (403 +
        `X-RateLimit-Remaining: 0`, wait until `X-RateLimit-Reset`) and the
        secondary/abuse limit (429 + `Retry-After`). Any other status code
        (2xx, or a "real" 4xx like 401/404/422) is returned immediately for
        the caller to interpret — this only handles "try again", never "was
        this successful".

        A raw network/timeout error (`httpx.RequestError`) is only retried
        when `idempotent=True` (the default, used for GETs) — for a write
        like posting a review or filing an issue, a timeout means we don't
        actually know whether GitHub received and applied it, so retrying
        risks a duplicate review/issue. Callers making a write pass
        `idempotent=False` to fail fast on that ambiguity instead.
        """
        last_exc: Exception | None = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                resp = await client.request(method, url, **kwargs)
            except httpx.RequestError as e:
                if not idempotent:
                    raise GitHubClientError(
                        f"Network error calling GitHub API ({method} {url}); "
                        f"the write's outcome is unknown, not retrying: {e}"
                    ) from e
                last_exc = e
                if attempt == _MAX_ATTEMPTS:
                    raise GitHubClientError(
                        f"Network error calling GitHub API ({method} {url}): {e}"
                    ) from e
                await asyncio.sleep(_BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)))
                continue

            if resp.status_code == 403 and resp.headers.get("X-RateLimit-Remaining") == "0":
                if attempt == _MAX_ATTEMPTS:
                    raise GitHubClientError(
                        f"GitHub API rate limit exhausted for {method} {url}"
                    )
                reset_at = resp.headers.get("X-RateLimit-Reset")
                wait_s = max(0.0, float(reset_at) - time.time()) if reset_at else _BASE_BACKOFF_SECONDS
                await asyncio.sleep(min(wait_s, _MAX_BACKOFF_SECONDS))
                continue

            if resp.status_code == 429:
                if attempt == _MAX_ATTEMPTS:
                    raise GitHubClientError(f"GitHub API secondary rate limit hit for {method} {url}")
                retry_after = resp.headers.get("Retry-After")
                wait_s = float(retry_after) if retry_after else _BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
                await asyncio.sleep(min(wait_s, _MAX_BACKOFF_SECONDS))
                continue

            if resp.status_code in _RETRYABLE_STATUS_CODES and attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(_BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)))
                continue

            return resp

        # Unreachable in practice (the loop always returns or raises above),
        # but keeps the type checker honest and fails closed if it ever isn't.
        raise GitHubClientError(
            f"GitHub API request failed after {_MAX_ATTEMPTS} attempts: {method} {url}"
        ) from last_exc

    async def fetch_pr(self, owner: str, repo: str, pr_number: int) -> PRMetadata:
        """Fetch PR metadata + the list of changed files (GET, read-only)."""
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers()) as client:
            pr_resp = await self._request(
                client, "GET", f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"
            )
            if pr_resp.status_code != 200:
                raise GitHubClientError(
                    f"Failed to fetch PR #{pr_number}: {pr_resp.status_code} {pr_resp.text[:300]}"
                )
            pr_data = pr_resp.json()

            files: list[PRFile] = []
            page = 1
            while True:
                files_resp = await self._request(
                    client, "GET",
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
            try:
                resp = await self._request(
                    client, "GET", f"{self.base_url}/repos/{owner}/{repo}/contents/{path}",
                    params={"ref": ref},
                )
            except GitHubClientError as e:
                logger.warning("Failed to fetch file content for %s@%s: %s", path, ref, e)
                return None
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
            resp = await self._request(
                client, "POST", f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/reviews",
                idempotent=False,
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
            resp = await self._request(
                client, "POST", f"{self.base_url}/repos/{owner}/{repo}/issues",
                idempotent=False,
                json={"title": title, "body": body},
            )
            if resp.status_code not in (200, 201):
                raise GitHubClientError(
                    f"Failed to file issue: {resp.status_code} {resp.text[:300]}"
                )
            return resp.json()
