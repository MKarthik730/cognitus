from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.preset import CustomAgentPreset
from app.models.user import User
from app.schemas.preset import (
    PresetListResponse,
    PresetResponse,
    PresetSaveRequest,
)
from app.services.prompt_guard import check_injection

router = APIRouter(prefix="/api/presets", tags=["presets"])


@router.get("/", response_model=PresetListResponse)
async def list_presets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PresetListResponse:
    """List all presets saved by the current user."""
    result = await db.execute(
        select(CustomAgentPreset)
        .where(CustomAgentPreset.user_id == current_user.id)
        .order_by(CustomAgentPreset.created_at.desc())
    )
    presets = result.scalars().all()

    return PresetListResponse(
        presets=[
            PresetResponse(
                id=p.id,
                label=p.label,
                instruction=p.instruction,
                role=p.role,
                color=p.color,
                bias=p.bias,
                confidence_threshold=p.confidence_threshold,
                created_at=p.created_at,
                use_count=p.use_count,
            )
            for p in presets
        ]
    )


@router.post("/", response_model=PresetResponse, status_code=status.HTTP_201_CREATED)
async def save_preset(
    body: PresetSaveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PresetResponse:
    """Save a custom agent preset for reuse."""
    # Run prompt injection check
    injection_error = check_injection(body.instruction)
    if injection_error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Prompt injection detected: {injection_error}",
        )

    preset = CustomAgentPreset(
        user_id=current_user.id,
        label=body.label,
        instruction=body.instruction,
        role=body.role,
        color=body.color,
        bias=body.bias,
        confidence_threshold=body.confidence_threshold,
        use_count=0,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)

    return PresetResponse(
        id=preset.id,
        label=preset.label,
        instruction=preset.instruction,
        role=preset.role,
        color=preset.color,
        bias=preset.bias,
        confidence_threshold=preset.confidence_threshold,
        created_at=preset.created_at,
        use_count=preset.use_count,
    )


@router.delete("/{preset_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a saved preset."""
    result = await db.execute(
        select(CustomAgentPreset).where(
            CustomAgentPreset.id == preset_id,
            CustomAgentPreset.user_id == current_user.id,
        )
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preset not found",
        )

    await db.delete(preset)
    await db.commit()


@router.post("/{preset_id}/use/", response_model=PresetResponse)
async def use_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PresetResponse:
    """
    Use a preset — increments its use_count and returns the preset data
    for injection into the current graph.
    """
    result = await db.execute(
        select(CustomAgentPreset).where(
            CustomAgentPreset.id == preset_id,
            CustomAgentPreset.user_id == current_user.id,
        )
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preset not found",
        )

    # Increment use count
    preset.use_count = (preset.use_count or 0) + 1
    await db.commit()
    await db.refresh(preset)

    return PresetResponse(
        id=preset.id,
        label=preset.label,
        instruction=preset.instruction,
        role=preset.role,
        color=preset.color,
        bias=preset.bias,
        confidence_threshold=preset.confidence_threshold,
        created_at=preset.created_at,
        use_count=preset.use_count,
    )
