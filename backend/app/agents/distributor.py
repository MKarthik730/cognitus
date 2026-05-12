from typing import get_args

from backend.app.graph.state import DistributorOutput, DomainName
from backend.app.services.hf_service import HFService

DISTRIBUTOR_SYSTEM_PROMPT = (
    "You are a domain classifier. Given a situation, determine which expert domains "
    "are most relevant for analysis. Available domains: legal, finance, medical, "
    "technology, education, science, business, ethics, psychology, sociology. "
    "Respond with ONLY a comma-separated list of the 3-5 most relevant domains "
    "followed by a brief explanation. Format: 'domains: domain1, domain2, ...'"
)

_VALID_DOMAINS: set[str] = set(get_args(DomainName))


class DistributorNode:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    @staticmethod
    def _parse_domains(text: str) -> list[str]:
        for line in text.lower().splitlines():
            if line.startswith("domains:"):
                parts = line.replace("domains:", "").strip()
                return [
                    d.strip() for d in parts.split(",") if d.strip() in _VALID_DOMAINS
                ]
        words = text.lower().replace(",", " ").split()
        seen: list[str] = []
        for w in words:
            if w in _VALID_DOMAINS and w not in seen:
                seen.append(w)
        return seen[:5]

    async def dispatch(self, situation: str) -> DistributorOutput:
        response, model = await self.hf_service.generate(
            DISTRIBUTOR_SYSTEM_PROMPT, situation
        )
        domains = self._parse_domains(response)
        return DistributorOutput(
            domains=domains or ["technology", "business", "ethics"],
            reasoning=response.strip(),
            model_used=model,
        )
