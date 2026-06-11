from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.models.user import User
from app.schemas.plan import PlanResponse, PlannerRequest
from app.services.planner import generate_plan

router = APIRouter(prefix="/api/plan", tags=["plan"])


@router.post("/", response_model=PlanResponse)
async def plan_analysis(
    body: PlannerRequest,
    current_user: User = Depends(get_current_user),
) -> PlanResponse:
    """
    Generate a dynamic node graph for the user's query and selected mode.

    The Planner LLM analyzes the query and produces a tailored set of
    agent nodes and edges that define the deliberation pipeline.
    """
    try:
        plan = await generate_plan(
            query=body.query,
            mode=body.mode,
        )

        return PlanResponse(
            nodes=plan.get("nodes", []),
            edges=plan.get("edges", []),
            mode=plan.get("mode", body.mode),
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Planner failed: {str(e)}",
        )
