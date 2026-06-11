from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PresetSaveRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    instruction: str = Field(..., min_length=1, max_length=300)
    role: str = Field(default="analyst")
    color: str = Field(default="indigo")
    bias: float = Field(default=0.5, ge=0.0, le=1.0)
    confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0, alias="confidenceThreshold")


class PresetResponse(BaseModel):
    id: int
    label: str
    instruction: str
    role: str
    color: str
    bias: float
    confidence_threshold: float
    created_at: datetime
    use_count: int


class PresetListResponse(BaseModel):
    presets: list[PresetResponse]
