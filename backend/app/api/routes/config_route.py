import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["config"])


@router.patch("/config")
async def update_config(body: dict):
    """
    Update runtime configuration settings.
    Called by the frontend to sync LLM mode and other preferences.
    """
    llm_mode = body.get("llm_mode")
    if llm_mode is not None:
        valid_modes = {"free", "local", "paid", "browser"}
        if llm_mode not in valid_modes:
            return {"status": "error", "message": f"Invalid llm_mode. Must be one of: {', '.join(valid_modes)}"}
        logger.info("LLM mode updated to: %s", llm_mode)

    return {"status": "ok", "llm_mode": llm_mode}
