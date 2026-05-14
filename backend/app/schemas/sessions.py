from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SessionCreate(BaseModel):
    title: str
    situation: str


class SessionResponse(BaseModel):
    id: int
    user_id: int
    title: str
    situation: str
    status: str
    created_at: datetime
    updated_at: datetime


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total: int
