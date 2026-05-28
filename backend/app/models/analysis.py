from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.agreement import Agreement
    from app.models.contradiction import Contradiction
    from app.models.expert_response import ExpertResponse
    from app.models.session import Session


class Analysis(Base, TimestampMixin):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    distributor_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cross_check_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    synthesis_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    consensus_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    session: Mapped["Session"] = relationship("Session", back_populates="analyses")
    expert_responses: Mapped[list["ExpertResponse"]] = relationship(
        "ExpertResponse", back_populates="analysis", cascade="all, delete-orphan"
    )
    contradictions: Mapped[list["Contradiction"]] = relationship(
        "Contradiction", back_populates="analysis", cascade="all, delete-orphan"
    )
    agreements: Mapped[list["Agreement"]] = relationship(
        "Agreement", back_populates="analysis", cascade="all, delete-orphan"
    )
