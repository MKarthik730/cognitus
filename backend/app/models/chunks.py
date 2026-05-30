"""DocumentChunk ORM model for RAG context slicing with pgvector support."""

from __future__ import annotations

from sqlalchemy import Column, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import ARRAY

from app.models.base import Base


class DocumentChunk(Base):
    """Stores chunked document content with vector embeddings for RAG retrieval."""

    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(ARRAY(Float), nullable=True, comment="pgvector embedding (384d)")

    session = relationship("Session", backref="document_chunks")

    def __repr__(self) -> str:
        return f"<DocumentChunk(session_id={self.session_id}, file='{self.file_name}', chunk={self.chunk_index})>"
