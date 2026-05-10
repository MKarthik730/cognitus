from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base

if TYPE_CHECKING:
    from backend.app.models.analysis import Analysis


class Agreement(Base):
    __tablename__ = "agreements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    analysis_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    domain_a: Mapped[str] = mapped_column(String(50), nullable=False)
    domain_b: Mapped[str] = mapped_column(String(50), nullable=False)
    points: Mapped[str] = mapped_column(Text, nullable=False)

    analysis: Mapped["Analysis"] = relationship("Analysis", back_populates="agreements")
