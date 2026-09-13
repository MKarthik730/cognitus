"""Live research source catalog.

- GET /api/sources — the curated, no-API-key source catalog (grouped by
  audience), so the frontend has a single source of truth to render the
  category picker from instead of duplicating the list client-side.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.services.live_sources import CURATED_SOURCES, MAX_CUSTOM_URLS

router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get("")
async def list_sources() -> dict:
    return {
        "categories": {
            category: [{"name": s["name"]} for s in sources]
            for category, sources in CURATED_SOURCES.items()
        },
        "max_custom_urls": MAX_CUSTOM_URLS,
    }
