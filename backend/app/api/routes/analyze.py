import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agreement import Agreement
from app.models.analysis import Analysis
from app.models.contradiction import Contradiction
from app.models.expert_response import ExpertResponse
from app.models.session import Session
from app.models.user import User
from app.schemas.analyze import (
    AgreementSchema,
    AnalyzeRequest,
    AnalysisResponse,
    ContradictionSchema,
    ExpertResponseSchema,
)
from app.services.hf_service import HFService
from app.services.llm_router import get_llm_router
from app.services.ghost_mode import GhostModeManager
from app.services.rate_limiter import RateLimiter
from app.graph.council_graph import CouncilGraph
from app.core.config import settings

router = APIRouter(prefix="/api/analyze", tags=["analyze"])

hf_service = HFService()
rate_limiter = RateLimiter.__new__(RateLimiter)
council_graph = CouncilGraph(hf_service)
ghost_mgr = GhostModeManager()


@router.post("/", response_model=AnalysisResponse)
async def analyze(
    body: AnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalysisResponse:
    # LLM Router health check
    router = get_llm_router()
    errors = router.validate_config()
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"LLM configuration error: {'; '.join(errors)}",
        )
    result = await db.execute(
        select(Session).where(
            Session.id == body.session_id, Session.user_id == current_user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    # Check Ghost Mode
    ghost_level = body.ghost_level or "off"
    can_proceed, restriction = await ghost_mgr.can_analyze(ghost_level)
    if not can_proceed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=restriction,
        )

    # Ghost mode: skip persistence for Shadow, Void, Phantom
    skip_persistence = ghost_level in ("shadow", "void", "phantom")

    if skip_persistence:
        analysis_id = 0
        council_result = await council_graph.run(
            situation=session.situation,
            session_id=str(session.id),
            user_id=current_user.id,
            analysis_mode=body.analysis_mode or "standard",
        )
        return await _build_ghost_response(council_result)

    analysis = Analysis(
        session_id=session.id,
        status="processing",
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    try:
        council_result = await council_graph.run(
            situation=session.situation,
            session_id=str(session.id),
            user_id=current_user.id,
            analysis_mode=body.analysis_mode or "standard",
        )

        distributor_json = json.dumps(
            {
                "domains": council_result.get("distributor", {}).get("domains", []),
                "reasoning": council_result.get("distributor", {}).get("reasoning", ""),
                "model_used": council_result.get("distributor", {}).get(
                    "model_used", ""
                ),
            }
        )

        cross_check_data = council_result.get("cross_check", {})
        cross_check_json = json.dumps(
            {
                "consensus_score": cross_check_data.get("consensus_score", 0.5),
                "contradictions": cross_check_data.get("contradictions", []),
                "agreements": cross_check_data.get("agreements", []),
                "model_used": cross_check_data.get("model_used", ""),
            }
        )

        synthesis_data = council_result.get("synthesis", {})
        synthesis_json = json.dumps(
            {
                "verdict": synthesis_data.get("verdict", ""),
                "reasoning": synthesis_data.get("reasoning", ""),
                "confidence": synthesis_data.get("confidence", "medium"),
                "consensus_score": synthesis_data.get("consensus_score", 0.5),
                "model_used": synthesis_data.get("model_used", ""),
            }
        )

        analysis.distributor_output = distributor_json
        analysis.cross_check_output = cross_check_json
        analysis.synthesis_output = synthesis_json
        analysis.consensus_score = council_result.get("synthesis", {}).get(
            "consensus_score", 0.5
        )
        analysis.status = "completed"
        analysis.completed_at = datetime.now(timezone.utc)

        if "experts" in council_result:
            for domain, expert in council_result["experts"].items():
                expert_rec = ExpertResponse(
                    analysis_id=analysis.id,
                    domain=domain,
                    analysis_text=expert.get("analysis", ""),
                    confidence=expert.get("confidence", "medium"),
                    model_used=expert.get("model_used", ""),
                    processing_time_ms=expert.get("processing_time_ms", 0),
                )
                db.add(expert_rec)

        if "cross_check" in council_result:
            cc = council_result["cross_check"]
            for c in cc.get("contradictions", []):
                contra = Contradiction(
                    analysis_id=analysis.id,
                    domain_a=c["between"][0],
                    domain_b=c["between"][1],
                    type=c["type"],
                    description=c["description"],
                    severity=c["severity"],
                )
                db.add(contra)
            for a in cc.get("agreements", []):
                agree = Agreement(
                    analysis_id=analysis.id,
                    domain_a=a["between"][0],
                    domain_b=a["between"][1],
                    points="|".join(a["points"]),
                )
                db.add(agree)

        await db.commit()
        await db.refresh(analysis)

    except Exception as e:
        analysis.status = "failed"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analysis failed: {str(e)}",
        )

    return await _build_analysis_response(analysis, db)


async def _build_ghost_response(council_result: dict) -> AnalysisResponse:
    """Build a response for ghost mode analyses (no persistence)."""
    import uuid
    now = datetime.now(timezone.utc)
    synthesis = council_result.get("synthesis", {})
    cross_check = council_result.get("cross_check", {})
    experts = council_result.get("experts", {})

    return AnalysisResponse(
        id=0,
        session_id=0,
        distributor_output=json.dumps(council_result.get("distributor", {})),
        cross_check_output=json.dumps(cross_check),
        synthesis_output=json.dumps(synthesis),
        consensus_score=synthesis.get("consensus_score", 0.5),
        status="completed",
        completed_at=now,
        expert_responses=[
            ExpertResponseSchema(
                domain=d,
                analysis_text=e.get("analysis", ""),
                confidence=e.get("confidence", "medium"),
                model_used=e.get("model_used", ""),
                processing_time_ms=e.get("processing_time_ms", 0),
            )
            for d, e in experts.items()
        ],
        contradictions=[
            ContradictionSchema(
                domain_a=c["between"][0],
                domain_b=c["between"][1],
                type=c["type"],
                description=c["description"],
                severity=c["severity"],
            )
            for c in cross_check.get("contradictions", [])
        ],
        agreements=[
            AgreementSchema(
                domain_a=a["between"][0],
                domain_b=a["between"][1],
                points=a.get("points", []),
            )
            for a in cross_check.get("agreements", [])
        ],
        created_at=now,
        updated_at=now,
    )


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalysisResponse:
    result = await db.execute(
        select(Analysis)
        .join(Session)
        .where(
            Analysis.id == analysis_id,
            Session.user_id == current_user.id,
        )
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )
    return await _build_analysis_response(analysis, db)


async def _build_analysis_response(
    analysis: Analysis, db: AsyncSession
) -> AnalysisResponse:
    experts_result = await db.execute(
        select(ExpertResponse).where(ExpertResponse.analysis_id == analysis.id)
    )
    experts = experts_result.scalars().all()

    contradictions_result = await db.execute(
        select(Contradiction).where(Contradiction.analysis_id == analysis.id)
    )
    contradictions = contradictions_result.scalars().all()

    agreements_result = await db.execute(
        select(Agreement).where(Agreement.analysis_id == analysis.id)
    )
    agreements = agreements_result.scalars().all()

    return AnalysisResponse(
        id=analysis.id,
        session_id=analysis.session_id,
        distributor_output=analysis.distributor_output,
        cross_check_output=analysis.cross_check_output,
        synthesis_output=analysis.synthesis_output,
        consensus_score=analysis.consensus_score,
        status=analysis.status,
        completed_at=analysis.completed_at,
        expert_responses=[
            ExpertResponseSchema(
                domain=e.domain,
                analysis_text=e.analysis_text,
                confidence=e.confidence,
                model_used=e.model_used,
                processing_time_ms=e.processing_time_ms,
            )
            for e in experts
        ],
        contradictions=[
            ContradictionSchema(
                domain_a=c.domain_a,
                domain_b=c.domain_b,
                type=c.type,
                description=c.description,
                severity=c.severity,
            )
            for c in contradictions
        ],
        agreements=[
            AgreementSchema(
                domain_a=a.domain_a,
                domain_b=a.domain_b,
                points=a.points.split("|") if a.points else [],
            )
            for a in agreements
        ],
        created_at=analysis.created_at,
        updated_at=analysis.updated_at,
    )
