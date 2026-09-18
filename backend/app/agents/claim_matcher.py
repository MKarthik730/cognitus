"""Claim-vs-artifact matching — the one narrow, evidence-quoting LLM check
in the whole Verdict pipeline.

Deliberately scoped tight: given one claim (from the PR description or an
opinion-layer finding) and the actual diff text, it must either quote the
diff lines that support the claim or say the claim is unsupported. It never
infers intent, and it never gets to unilaterally approve anything — that
decision belongs to app.agents.verdict_synthesizer's hardcoded gate.
"""

from __future__ import annotations

import json
import logging
import time

from redis.asyncio import Redis

from app.core.config import settings
from app.schemas.node_output import clean_json_response
from app.schemas.verdict_output import ClaimMatchResult
from app.services.cache_key import make_cache_key
from app.services.hf_service import HFService

logger = logging.getLogger(__name__)

CACHE_TTL = 3600

SYSTEM_PROMPT = """You are a skeptical claim verifier. You are given one specific claim about \
what a code change does, and the actual unified diff. Your only job is to determine whether \
the diff contains evidence supporting that exact claim.

Rules:
- Quote the exact diff lines (including the leading +/-) that support the claim.
- If you cannot find supporting lines, say so explicitly — do not infer intent, and do not \
give credit for code that is merely related to the claim but doesn't actually implement it.
- "partial" means the diff does part of what the claim says but not all of it.
- "mismatch" means the diff contradicts or does something different from the claim.
- "unsupported" means you found no evidence either way — supporting_lines MUST be empty in \
this case.

Respond ONLY with valid JSON, no markdown fences, no explanation outside the JSON:
{
    "claim": "<the claim, verbatim>",
    "verdict": "match" | "mismatch" | "partial" | "unsupported",
    "supporting_lines": ["<exact quoted diff line>", ...],
    "confidence": <integer 0-100>
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema, or a "
    "non-unsupported verdict had no supporting_lines. Retry now, responding ONLY with the "
    "JSON object."
)

USER_TEMPLATE = """CLAIM:
{claim}

DIFF:
{diff_text}
"""

MAX_DIFF_CHARS = 12000


def _get_redis() -> Redis | None:
    try:
        return Redis.from_url(settings.REDIS_URL, decode_responses=True)
    except Exception as e:
        logger.warning("Redis unavailable for claim-matcher caching: %s", e)
        return None


def _is_structurally_valid(result: ClaimMatchResult) -> bool:
    if result.verdict == "unsupported":
        return len(result.supporting_lines) == 0
    return len(result.supporting_lines) > 0


class ClaimMatcher:
    def __init__(self, hf_service: HFService | None = None) -> None:
        self.hf_service = hf_service or HFService()

    async def match(self, claim: str, diff_text: str) -> ClaimMatchResult:
        diff_text = diff_text[:MAX_DIFF_CHARS]

        cached = await self._check_cache(claim, diff_text)
        if cached is not None:
            return cached

        result = await self._generate(claim, diff_text, is_retry=False)
        if result is None:
            result = ClaimMatchResult(
                claim=claim,
                verdict="unsupported",
                supporting_lines=[],
                confidence=0,
            )

        await self._store_cache(claim, diff_text, result)
        return result

    async def _generate(
        self, claim: str, diff_text: str, is_retry: bool
    ) -> ClaimMatchResult | None:
        system = SYSTEM_PROMPT + (RETRY_PROMPT if is_retry else "")
        user = USER_TEMPLATE.format(claim=claim, diff_text=diff_text)

        try:
            from app.services.structured_llm import generate_structured

            result = await generate_structured(
                ClaimMatchResult, system, user, max_tokens=settings.HF_EXPERT_MAX_TOKENS,
            )
        except Exception as e:
            logger.warning("Structured claim-match generation failed, falling back: %s", e)
            try:
                raw, _model = await self.hf_service.generate(
                    system, user, max_tokens=settings.HF_EXPERT_MAX_TOKENS,
                )
                cleaned = clean_json_response(raw)
                data = json.loads(cleaned)
                result = ClaimMatchResult(**data)
            except Exception as e2:
                logger.warning("Manual claim-match parse also failed: %s", e2)
                if not is_retry:
                    return await self._generate(claim, diff_text, is_retry=True)
                return None

        if not _is_structurally_valid(result):
            if not is_retry:
                logger.warning("Claim-match structurally invalid, retrying once: %s", result)
                return await self._generate(claim, diff_text, is_retry=True)
            # Fail safe: an unresolvable structural violation is treated as
            # unsupported, never as a match — the gate must never be fooled
            # by a claim/evidence mismatch in the tool's own output.
            return ClaimMatchResult(
                claim=claim, verdict="unsupported", supporting_lines=[], confidence=0,
            )

        return result

    async def _check_cache(self, claim: str, diff_text: str) -> ClaimMatchResult | None:
        try:
            redis = _get_redis()
            if redis is None:
                return None
            cache_key = make_cache_key(diff_text, "claim_matcher", claim)
            cached = await redis.get(cache_key)
            await redis.aclose()
            if cached:
                return ClaimMatchResult(**json.loads(cached))
        except Exception as e:
            logger.debug("Claim-match cache check failed: %s", e)
        return None

    async def _store_cache(self, claim: str, diff_text: str, result: ClaimMatchResult) -> None:
        try:
            redis = _get_redis()
            if redis is None:
                return
            cache_key = make_cache_key(diff_text, "claim_matcher", claim)
            await redis.setex(cache_key, CACHE_TTL, result.model_dump_json())
            await redis.aclose()
        except Exception as e:
            logger.debug("Claim-match cache store failed: %s", e)
