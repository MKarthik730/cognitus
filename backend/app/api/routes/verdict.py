from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.graph.verdict_graph import VerdictGraph
from app.ingestion.github_client import GitHubClientError
from app.models.user import User
from app.schemas.verdict_output import VerdictScorecard
from app.schemas.verdict_request import VerdictAnalyzeRequest
from app.services.hf_service import HFService

router = APIRouter(prefix="/api/verdict", tags=["verdict"])


@router.post("/analyze", response_model=VerdictScorecard)
async def analyze_pr(
    body: VerdictAnalyzeRequest,
    current_user: User = Depends(get_current_user),
) -> VerdictScorecard:
    """Run the full Verdict pipeline against a PR synchronously (no streaming).

    Prefer the /ws/{session_id} `mode: "verdict"` path for live progress —
    this route exists for CI/curl/eval-harness use where a single JSON
    response is more convenient than a WebSocket connection.
    """
    graph = VerdictGraph(HFService())
    try:
        return await graph.run_verdict(body.pr_url, github_token=body.github_token)
    except GitHubClientError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Verdict run failed: {e}",
        )
