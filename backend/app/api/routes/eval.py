"""Admin endpoint for running the eval harness.

Requires ADMIN_SECRET for authorization.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def verify_admin_secret(x_admin_secret: str = Header("")) -> None:
    if not settings.ADMIN_SECRET:
        raise HTTPException(status_code=503, detail="ADMIN_SECRET not configured")
    if x_admin_secret != settings.ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Invalid admin secret")


@router.post("/eval/run", dependencies=[Depends(verify_admin_secret)])
async def run_eval_all() -> dict[str, Any]:
    """Run all eval fixtures and return results."""
    try:
        from evals.runner import run_all_evals, print_results_table
    except ImportError:
        raise HTTPException(status_code=500, detail="Eval harness not available")

    results = await run_all_evals()
    passed = sum(1 for r in results if r.overall_pass)
    return {
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "results": [
            {
                "name": r.fixture_name,
                "pass": r.overall_pass,
                "consensus_score": r.consensus_score,
                "findings_missing": r.findings_missing,
                "forbidden_found": r.forbidden_found,
                "synthesis_keywords_missing": r.synthesis_keywords_missing,
                "error": r.error,
            }
            for r in results
        ],
    }
