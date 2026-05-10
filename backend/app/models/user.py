from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from backend.app.models.api_usage_log import ApiUsageLog
    from backend.app.models.session import Session


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True)

    sessions: Mapped[list["Session"]] = relationship(
        "Session", back_populates="user", cascade="all, delete-orphan"
    )
    api_usage_logs: Mapped[list["ApiUsageLog"]] = relationship(
        "ApiUsageLog", back_populates="user", cascade="all, delete-orphan"
    )
