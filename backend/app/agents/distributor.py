from __future__ import annotations

import json
import logging

from backend.app.agents.expert_node import DOMAIN_PROMPTS
from backend.app.core.config import settings
from backend.app.graph.state import DistributorOutput
from backend.app.schemas.node_output import clean_json_response
from backend.app.services.hf_service import HFService

logger = logging.getLogger(__name__)

DISTRIBUTOR_SYSTEM_PROMPT = """
You are a domain classifier. Given a situation, determine which expert domains
are most relevant for analysis. Available domains: legal, finance, medical,
technology, education, science, business, ethics, psychology, sociology.

Respond ONLY with a JSON object. No preamble, no markdown fences, no explanation outside the JSON:
{
    "domains": ["<domain1>", "<domain2>", ...],
    "reasoning": "<brief explanation of why these domains were selected>"
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object."
)

_VALID_DOMAINS: set[str] = set(DOMAIN_PROMPTS.keys())


class DistributorNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    async def dispatch(self, situation: str) -> DistributorOutput:
        response, model = await self._generate_dispatch(situation, is_retry=False)

        domains, reasoning = self._try_parse(response)

        if not domains:
            # Retry once
            logger.warning("Distributor JSON parse failed, retrying...")
            response2, model2 = await self._generate_dispatch(situation, is_retry=True)
            domains, reasoning = self._try_parse(response2)
            if domains:
                model = model2

        return DistributorOutput(
            domains=domains or ["technology", "business", "ethics"],
            reasoning=reasoning or response or "",
            model_used=model,
        )

    def _try_parse(self, raw: str | None) -> tuple[list[str], str]:
        """Try to parse a raw response into domains list and reasoning string."""
        if not raw:
            return [], ""

        try:
            cleaned = clean_json_response(raw)
            data = json.loads(cleaned)

            raw_domains = data.get("domains", [])
            reasoning = data.get("reasoning", "")

            # Filter to only valid domains
            domains = [
                d.strip().lower()
                for d in raw_domains
                if d.strip().lower() in _VALID_DOMAINS
            ]

            return domains[:5], reasoning
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse distributor JSON: %s", e)
            return [], ""

    async def _generate_dispatch(
        self, situation: str, is_retry: bool = False
    ) -> tuple[str | None, str]:
        """Generate domain dispatch with optional retry."""
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
