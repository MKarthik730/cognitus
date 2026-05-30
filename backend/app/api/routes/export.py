"""Export endpoints for PDF, JSON, and share link generation.

- POST /api/export/pdf — Generate PDF report from analysis
- GET /api/export/json/{session_id} — Full analysis as structured JSON
- GET /view/{session_id} — Read-only viewer page
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user_optional
from app.models.analysis import Analysis
from app.models.agreement import Agreement
from app.models.contradiction import Contradiction
from app.models.expert_response import ExpertResponse
from app.models.session import Session
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["export"])


# ---------------------------------------------------------------------------
# PDF Export
# ---------------------------------------------------------------------------


def _generate_pdf_report(analysis_data: dict[str, Any]) -> bytes:
    """Generate a PDF report from analysis data using PyMuPDF (fitz).

    Falls back to a simple text-based report if PyMuPDF is not available.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not installed, generating text report instead")
        return _generate_text_report(analysis_data)

    doc = fitz.open()
    page = doc.new_page()

    # Page 1: Title, date, question, consensus score, verdict
    synthesis = json.loads(analysis_data.get("synthesis_output", "{}"))
    consensus = analysis_data.get("consensus_score", 0.5)

    y = 50
    page.insert_text((50, y), "Cognitus Analysis Report", fontsize=20, fontname="helv")
    y += 30
    page.insert_text((50, y), f"Completed: {analysis_data.get('completed_at', 'N/A')}", fontsize=11)
    y += 20
    page.insert_text((50, y), f"Consensus Score: {consensus}", fontsize=11)
    y += 15
    page.insert_text((50, y), f"Verdict: {synthesis.get('verdict', 'N/A')}", fontsize=13)
    y += 15
    page.insert_text((50, y), f"Confidence: {synthesis.get('confidence', 'medium')}", fontsize=11)
    y += 25

    # Expert sections
    experts = analysis_data.get("experts", [])
    for exp in experts:
        page.insert_text((50, y), f"--- {exp.get('domain', 'Expert')} ---", fontsize=12)
        y += 18
        page.insert_text((60, y), f"Confidence: {exp.get('confidence', 'medium')}", fontsize=10)
        y += 15
        analysis_text = exp.get("analysis_text", "")
        # Word-wrap long text
        for line in _wrap_text(analysis_text[:500], 80):
            page.insert_text((60, y), line, fontsize=10)
            y += 12
            if y > 780:
                page = doc.new_page()
                y = 50
        y += 10

        # Cross-examination if available
        cross_examine = exp.get("cross_examine", {})
        if cross_examine:
            page.insert_text((60, y), "Cross-Examination:", fontsize=11)
            y += 15
            maintained = cross_examine.get("maintains_position", True)
            page.insert_text((70, y), f"Position maintained: {maintained}", fontsize=10)
            y += 12
            if cross_examine.get("points_of_agreement"):
                for p in cross_examine["points_of_agreement"][:3]:
                    page.insert_text((70, y), f"Agreement: {p[:80]}", fontsize=10)
                    y += 12
            if cross_examine.get("points_of_disagreement"):
                for p in cross_examine["points_of_disagreement"][:3]:
                    page.insert_text((70, y), f"Disagreement: {p[:80]}", fontsize=10)
                    y += 12
            y += 5

        if y > 750:
            page = doc.new_page()
            y = 50

    # Synthesis page
    page = doc.new_page()
    y = 50
    page.insert_text((50, y), "Synthesis", fontsize=16)
    y += 25
    page.insert_text((50, y), "Reasoning:", fontsize=12)
    y += 18
    for line in _wrap_text(synthesis.get("reasoning", ""), 80):
        page.insert_text((60, y), line, fontsize=10)
        y += 12
        if y > 780:
            page = doc.new_page()
            y = 50
    y += 15

    # Recommendations
    recommendations = synthesis.get("recommendations", [])
    if recommendations:
        page.insert_text((50, y), "Recommendations:", fontsize=12)
        y += 18
        for r in recommendations:
            page.insert_text((60, y), f"- {r}", fontsize=10)
            y += 12
            if y > 780:
                page = doc.new_page()
                y = 50
        y += 10

    # Minority report
    minority = synthesis.get("minority_report", "")
    if minority:
        page.insert_text((50, y), "Minority Report:", fontsize=12)
        y += 18
        for line in _wrap_text(minority, 80):
            page.insert_text((60, y), line, fontsize=10)
            y += 12

    pdf_bytes = doc.write()
    doc.close()
    return pdf_bytes


def _wrap_text(text: str, width: int = 80) -> list[str]:
    """Simple word-wrap for text insertion into PDF."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        if len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        lines.append(current)
    return lines


def _generate_text_report(analysis_data: dict[str, Any]) -> bytes:
    """Generate a plain text report as fallback."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("COGNITUS ANALYSIS REPORT")
    lines.append("=" * 60)
    lines.append(f"Completed: {analysis_data.get('completed_at', 'N/A')}")
    lines.append(f"Consensus Score: {analysis_data.get('consensus_score', 0.5)}")
    lines.append("")

    synthesis = json.loads(analysis_data.get("synthesis_output", "{}"))
    lines.append(f"Verdict: {synthesis.get('verdict', 'N/A')}")
    lines.append(f"Confidence: {synthesis.get('confidence', 'medium')}")
    lines.append("")

    experts = analysis_data.get("experts", [])
    for exp in experts:
        lines.append(f"--- {exp.get('domain', 'Expert')} ---")
        lines.append(f"  Confidence: {exp.get('confidence', 'medium')}")
        lines.append(f"  {exp.get('analysis_text', '')[:500]}")
        lines.append("")

    lines.append("=" * 60)
    return "\n".join(lines).encode("utf-8")


@router.post("/api/export/pdf")
async def export_pdf(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Generate a PDF report for a completed analysis."""
    body = await request.json()
    analysis_id = body.get("analysis_id")
    if not analysis_id:
        raise HTTPException(status_code=400, detail="analysis_id is required")

    # Load analysis data
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Load experts
    experts_result = await db.execute(
        select(ExpertResponse).where(ExpertResponse.analysis_id == analysis_id)
    )
    experts = experts_result.scalars().all()

    analysis_data = {
        "id": analysis.id,
        "session_id": analysis.session_id,
        "distributor_output": analysis.distributor_output,
        "cross_check_output": analysis.cross_check_output,
        "synthesis_output": analysis.synthesis_output,
        "consensus_score": analysis.consensus_score,
        "status": analysis.status,
        "completed_at": str(analysis.completed_at) if analysis.completed_at else "",
        "experts": [
            {
                "domain": e.domain,
                "analysis_text": e.analysis_text,
                "confidence": e.confidence,
                "model_used": e.model_used,
                "processing_time_ms": e.processing_time_ms,
            }
            for e in experts
        ],
    }

    pdf_bytes = _generate_pdf_report(analysis_data)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="cognitus-analysis-{analysis_id}.pdf"',
            "Content-Type": "application/pdf",
        },
    )


# ---------------------------------------------------------------------------
# JSON Export
# ---------------------------------------------------------------------------


@router.get("/api/export/json/{session_id}")
async def export_json(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> JSONResponse:
    """Export full analysis state as structured JSON."""
    # Find most recent completed analysis for this session
    result = await db.execute(
        select(Analysis)
        .where(
            Analysis.session_id == session_id,
            Analysis.status == "completed",
        )
        .order_by(Analysis.completed_at.desc())
        .limit(1)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="No completed analysis found for this session")

    # Load related data
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

    export_data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "analysis": {
            "id": analysis.id,
            "session_id": analysis.session_id,
            "status": analysis.status,
            "completed_at": str(analysis.completed_at) if analysis.completed_at else "",
            "consensus_score": analysis.consensus_score,
            "distributor_output": json.loads(analysis.distributor_output) if analysis.distributor_output else {},
            "cross_check_output": json.loads(analysis.cross_check_output) if analysis.cross_check_output else {},
            "synthesis_output": json.loads(analysis.synthesis_output) if analysis.synthesis_output else {},
            "created_at": str(analysis.created_at) if analysis.created_at else "",
        },
        "experts": [
            {
                "domain": e.domain,
                "analysis_text": e.analysis_text,
                "confidence": e.confidence,
                "model_used": e.model_used,
                "processing_time_ms": e.processing_time_ms,
            }
            for e in experts
        ],
        "contradictions": [
            {
                "domain_a": c.domain_a,
                "domain_b": c.domain_b,
                "type": c.type,
                "description": c.description,
                "severity": c.severity,
            }
            for c in contradictions
        ],
        "agreements": [
            {
                "domain_a": a.domain_a,
                "domain_b": a.domain_b,
                "points": a.points.split("|") if a.points else [],
            }
            for a in agreements
        ],
    }

    return JSONResponse(
        content=export_data,
        headers={
            "Content-Disposition": f'attachment; filename="cognitus-analysis-{analysis.id}.json"',
        },
    )


# ---------------------------------------------------------------------------
# Share link (read-only viewer)
# ---------------------------------------------------------------------------


@router.get("/view/{session_id}", response_class=HTMLResponse)
async def view_analysis_readonly(
    session_id: int,
    token: str = Query("", description="Read-only JWT token"),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Read-only viewer for shared analysis results."""
    # In production, validate the JWT token here
    if not token:
        raise HTTPException(status_code=401, detail="Read-only token required")

    # Load the session and latest analysis
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    analysis_result = await db.execute(
        select(Analysis)
        .where(Analysis.session_id == session_id, Analysis.status == "completed")
        .order_by(Analysis.completed_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="No completed analysis found")

    # Build embedded viewer HTML
    synthesis = json.loads(analysis.synthesis_output) if analysis.synthesis_output else {}
    cross_check = json.loads(analysis.cross_check_output) if analysis.cross_check_output else {}

    experts_result = await db.execute(
        select(ExpertResponse).where(ExpertResponse.analysis_id == analysis.id)
    )
    experts = experts_result.scalars().all()

    expert_html = ""
    for exp in experts:
        expert_html += f"""
        <div class="expert-card">
            <h3>{exp.domain}</h3>
            <div class="badge {exp.confidence}">{exp.confidence}</div>
            <p>{exp.analysis_text[:500]}</p>
        </div>
        """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cognitus — Shared Analysis</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 2rem; }}
        .container {{ max-width: 900px; margin: 0 auto; }}
        h1 {{ font-size: 2rem; margin-bottom: 0.5rem; color: #58a6ff; }}
        .meta {{ color: #8b949e; margin-bottom: 2rem; }}
        .verdict-card {{ background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }}
        .verdict-card h2 {{ color: #58a6ff; margin-bottom: 0.5rem; }}
        .consensus {{ font-size: 1.2rem; color: #7ee787; }}
        .badge {{ display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }}
        .badge.high {{ background: #1b3a1b; color: #7ee787; }}
        .badge.medium {{ background: #3a2e1b; color: #d29922; }}
        .badge.low {{ background: #3a1b1b; color: #f85149; }}
        .expert-card {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }}
        .expert-card h3 {{ color: #58a6ff; margin-bottom: 0.3rem; }}
        .footer {{ margin-top: 2rem; color: #8b949e; font-size: 0.9rem; text-align: center; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Cognitus Analysis</h1>
        <p class="meta">Session: {session_id} | Completed: {str(analysis.completed_at or '')[:19]}</p>

        <div class="verdict-card">
            <h2>Verdict</h2>
            <p>{synthesis.get('verdict', 'N/A')}</p>
            <p class="consensus">Consensus: {analysis.consensus_score:.0%}</p>
            <p>Confidence: <span class="badge {synthesis.get('confidence', 'medium')}">{synthesis.get('confidence', 'medium')}</span></p>
        </div>

        <h2>Expert Analyses</h2>
        {expert_html}

        <div class="footer">
            <p>Generated by Cognitus — AI-Powered Multi-Expert Analysis</p>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ---------------------------------------------------------------------------
# Share link generation
# ---------------------------------------------------------------------------


@router.post("/api/export/share")
async def generate_share_link(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> dict[str, str]:
    """Generate a read-only share link for an analysis."""
    body = await request.json()
    analysis_id = body.get("analysis_id")
    if not analysis_id:
        raise HTTPException(status_code=400, detail="analysis_id is required")

    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Create a signed token (simple JWT-like token for read-only access)
    import hashlib
    import hmac
    from app.core.config import settings

    payload = json.dumps({
        "analysis_id": analysis_id,
        "session_id": analysis.session_id,
        "scope": "readonly",
        "exp": (datetime.now(timezone.utc).timestamp() + 86400 * 7),  # 7 days
    })
    signature = hmac.new(
        settings.SECRET_KEY.encode() if settings.SECRET_KEY else b"cognitus-share-secret",
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    token = f"{payload}.{signature}"

    base_url = str(request.base_url).rstrip("/")
    share_url = f"{base_url}/view/{analysis.session_id}?token={token}"

    return {
        "share_url": share_url,
        "expires_in_days": 7,
    }
