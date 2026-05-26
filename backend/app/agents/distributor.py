from __future__ import annotations

import json
import logging

from backend.app.core.config import settings
from backend.app.graph.state import DistributorOutput, SubQuestion
from backend.app.schemas.node_output import clean_json_response
from backend.app.services.hf_service import HFService

logger = logging.getLogger(__name__)

DISTRIBUTOR_SYSTEM_PROMPT = """
You are a case decomposer. Given a situation, break it into 3-5 distinct
analytical sub-questions that different experts should answer independently.

Each sub-question should be:
- Specific to the case (not generic)
- Answerable without knowing the other sub-questions
- Meaningfully different from the others

Assign each sub-question to the most relevant domain from:
legal, finance, medical, technology, education, science, business, ethics, psychology, sociology

Respond ONLY with a JSON object. No preamble, no markdown fences, no explanation outside the JSON:
{
    "sub_questions": [
        {
            "id": "q1",
            "question": "<specific question>",
            "domain": "<domain>"
        },
        {
            "id": "q2",
            "question": "<specific question>",
            "domain": "<domain>"
        }
    ],
    "reasoning": "<brief explanation of how these questions decompose the case>"
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object."
)

_VALID_DOMAINS: set[str] = {
    "legal", "finance", "medical", "technology", "education",
    "science", "business", "ethics", "psychology", "sociology",
}

DEFAULT_FALLBACK_SUB_QUESTIONS: list[SubQuestion] = [
    {"id": "q1", "question": "What are the key facts and data points in this situation?", "domain": "business"},
    {"id": "q2", "question": "What are the risks and potential negative outcomes?", "domain": "ethics"},
    {"id": "q3", "question": "What technical or operational factors are at play?", "domain": "technology"},
]


class DistributorNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    async def dispatch(self, situation: str) -> DistributorOutput:
        response, model = await self._generate_dispatch(situation, is_retry=False)

        sub_questions, reasoning = self._try_parse(response)

        if not sub_questions:
            # Retry once
            logger.warning("Distributor JSON parse failed, retrying...")
            response2, model2 = await self._generate_dispatch(situation, is_retry=True)
            sub_questions, reasoning = self._try_parse(response2)
            if sub_questions:
                model = model2

        return DistributorOutput(
            sub_questions=sub_questions or DEFAULT_FALLBACK_SUB_QUESTIONS,
            reasoning=reasoning or (response or ""),
            model_used=model,
        )

    def _try_parse(self, raw: str | None) -> tuple[list[SubQuestion], str]:
        """Try to parse a raw response into sub-questions and reasoning."""
        if not raw:
            return [], ""

        try:
            cleaned = clean_json_response(raw)
            data = json.loads(cleaned)

            raw_questions = data.get("sub_questions", [])
            reasoning = data.get("reasoning", "")

            if not raw_questions or not isinstance(raw_questions, list):
                return [], reasoning

            sub_questions: list[SubQuestion] = []
            seen_ids: set[str] = set()

            for i, item in enumerate(raw_questions):
                if not isinstance(item, dict):
                    continue
                q_id = str(item.get("id", f"q{i + 1}"))
                question = (item.get("question") or "").strip()
                domain = (item.get("domain") or "").strip().lower()

                if not question or not domain:
                    continue
                if q_id in seen_ids:
                    continue
                if domain not in _VALID_DOMAINS:
                    continue

                seen_ids.add(q_id)
                sub_questions.append(SubQuestion(id=q_id, question=question, domain=domain))

            return sub_questions[:5], reasoning
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse distributor JSON: %s", e)
            return [], ""

    async def _generate_dispatch(
        self, situation: str, is_retry: bool = False
    ) -> tuple[str | None, str]:
        """Generate case decomposition with optional retry."""
        system = DISTRIBUTOR_SYSTEM_PROMPT
        if is_retry:
            system = system + RETRY_PROMPT

        try:
            response, model = await self.hf_service.generate(
                system,
                situation,
                max_tokens=settings.HF_DEFAULT_MAX_TOKENS,
            )
            return response, model
        except Exception as e:
            logger.error("Distributor generation failed: %s", e)
            return None, ""
