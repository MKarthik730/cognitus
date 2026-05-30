"""Embedding service for RAG context slicing using sentence-transformers + pgvector.

Chunks documents, generates embeddings locally (no API cost), stores in pgvector,
and retrieves relevant chunks per query using cosine similarity.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chunks import DocumentChunk

logger = logging.getLogger(__name__)

# Will be lazily loaded on first use
_embedder = None


def _get_embedder():
    """Lazy-load the sentence-transformers model."""
    global _embedder
    if _embedder is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedder = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Loaded sentence-transformers model: all-MiniLM-L6-v2")
        except ImportError:
            logger.warning(
                "sentence-transformers not installed. Install with: "
                "pip install sentence-transformers"
            )
            _embedder = None
    return _embedder


def chunk_document(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split a document into overlapping chunks.

    Args:
        text: The full document text.
        chunk_size: Maximum characters per chunk.
        overlap: Overlap characters between adjacent chunks.

    Returns:
        List of chunk strings.
    """
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # Try to break at a sentence boundary for cleaner chunks
        if end < len(text):
            # Look for sentence endings within the last 50 chars
            search_start = max(end - 50, start)
            last_period = text.rfind(". ", search_start, end)
            last_newline = text.rfind("\n\n", search_start, end)
            break_point = max(last_period + 1, last_newline + 1)
            if break_point > search_start:
                end = break_point

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end < len(text) else len(text)

    return chunks


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of chunks using sentence-transformers.

    Args:
        chunks: List of text chunks to embed.

    Returns:
        List of embedding vectors (384-dimension float lists).
    """
    embedder = _get_embedder()
    if embedder is None:
        logger.warning("Embedder not available, returning zero vectors")
        return [[0.0] * 384 for _ in chunks]

    try:
        # Run in thread pool to avoid blocking the event loop
        import asyncio
        embeddings = await asyncio.to_thread(embedder.encode, chunks, show_progress_bar=False)
        return [emb.tolist() for emb in embeddings]
    except Exception as e:
        logger.error("Embedding generation failed: %s", e)
        return [[0.0] * 384 for _ in chunks]


async def store_chunks(
    db: AsyncSession,
    session_id: int,
    file_name: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> list[DocumentChunk]:
    """Store chunked documents with embeddings in the database.

    Args:
        db: Database session.
        session_id: The session ID to associate chunks with.
        file_name: Original file name.
        chunks: List of text chunks.
        embeddings: List of embedding vectors.

    Returns:
        List of created DocumentChunk records.
    """
    records: list[DocumentChunk] = []
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        record = DocumentChunk(
            session_id=session_id,
            file_name=file_name,
            chunk_index=i,
            content=chunk_text,
            embedding=embedding,
        )
        db.add(record)
        records.append(record)

    await db.commit()
    logger.info("Stored %d chunks for session %s file '%s'", len(records), session_id, file_name)
    return records


async def retrieve_relevant(
    db: AsyncSession,
    session_id: int,
    query: str,
    top_k: int = 5,
) -> list[str]:
    """Retrieve the most relevant chunks for a query using cosine similarity.

    Requires pgvector extension to be enabled in PostgreSQL.

    Args:
        db: Database session.
        session_id: The session to search within.
        query: The search query (e.g., an expert node's role).
        top_k: Maximum number of chunks to return.

    Returns:
        List of chunk content strings, most relevant first.
    """
    embedder = _get_embedder()
    if embedder is None:
        logger.warning("Embedder not available, cannot retrieve chunks")
        return []

    try:
        import asyncio
        query_emb = await asyncio.to_thread(embedder.encode, query, show_progress_bar=False)
        query_vec = query_emb.tolist()

        # pgvector cosine similarity query
        sql = text("""
            SELECT content, 1 - (embedding <=> :query_vec::vector) AS similarity
            FROM document_chunks
            WHERE session_id = :session_id
              AND embedding IS NOT NULL
            ORDER BY similarity DESC
            LIMIT :top_k
        """)
        result = await db.execute(
            sql,
            {
                "query_vec": query_vec,
                "session_id": session_id,
                "top_k": top_k,
            },
        )
        rows = result.fetchall()
        return [row[0] for row in rows]

    except Exception as e:
        logger.warning("pgvector retrieval failed, falling back to sequential: %s", e)
        # Fallback: return chunks without vector similarity
        fallback_sql = text("""
            SELECT content FROM document_chunks
            WHERE session_id = :session_id
            ORDER BY chunk_index ASC
            LIMIT :top_k
        """)
        fallback_result = await db.execute(fallback_sql, {"session_id": session_id, "top_k": top_k})
        return [row[0] for row in fallback_result.fetchall()]
