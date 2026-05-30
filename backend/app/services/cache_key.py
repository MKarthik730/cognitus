"""Cache key generation for result caching.

Generates deterministic SHA256-based cache keys from the inputs
that determine an LLM response: file contents, node behavior, question.
"""

from __future__ import annotations

import hashlib
import json


def make_cache_key(
    file_contents: str,
    node_behavior: str,
    question: str,
) -> str:
    """Generate a deterministic SHA256 cache key.

    Args:
        file_contents: The document text or situation being analyzed.
        node_behavior: The expert node's behavior/system prompt.
        question: The guiding question or user prompt.

    Returns:
        A hex digest string prefixed with 'result:' for Redis key usage.
    """
    raw = json.dumps(
        {
            "file_contents": file_contents.strip(),
            "node_behavior": node_behavior.strip(),
            "question": question.strip(),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"result:{digest}"
