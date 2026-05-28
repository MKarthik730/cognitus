from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.analysis import Analysis


class Contradiction(Base):
    __tablename__ = "contradictions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    analysis_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    domain_a: Mapped[str] = mapped_column(String(50), nullable=False)
    domain_b: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="medium")

    analysis: Mapped["Analysis"] = relationship(
        "Analysis", back_populates="contradictions"
    )
