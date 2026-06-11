from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CustomAgentPreset(Base, TimestampMixin):
    __tablename__ = "custom_agent_presets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    instruction: Mapped[str] = mapped_column(String(300), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="analyst")
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="indigo")
    bias: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    confidence_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
