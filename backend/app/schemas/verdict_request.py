from pydantic import BaseModel, Field


class VerdictAnalyzeRequest(BaseModel):
    pr_url: str = Field(..., min_length=1, description="A GitHub PR URL, e.g. https://github.com/owner/repo/pull/123")
    github_token: str | None = Field(
        default=None,
        description="Overrides the server's GITHUB_TOKEN for this request only.",
    )
