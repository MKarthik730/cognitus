from typing import get_args

from backend.app.graph.state import DomainName, ExpertOutput
from backend.app.services.hf_service import HFService

DOMAIN_PROMPTS: dict[str, str] = {
    "legal": (
        "You are a senior legal counsel. Analyze the situation from a legal standpoint. "
        "Identify relevant laws, regulations, contractual issues, and legal risks. "
        "Provide clear reasoning and cite specific legal principles."
    ),
    "finance": (
        "You are a financial analyst. Evaluate the situation's financial implications. "
        "Consider costs, revenues, investments, market conditions, and economic impact. "
        "Provide quantitative reasoning where possible."
    ),
    "medical": (
        "You are a medical professional. Assess the situation from a health and medical perspective. "
        "Consider symptoms, treatments, risks, and public health implications. "
        "Base your analysis on established medical knowledge."
    ),
    "technology": (
        "You are a technology expert. Analyze the technical aspects of the situation. "
        "Consider system architecture, software, hardware, security, and feasibility. "
        "Identify technical risks and opportunities."
    ),
    "education": (
        "You are an education specialist. Examine the situation's educational dimensions. "
        "Consider learning outcomes, pedagogical approaches, curriculum impact, and training needs."
    ),
    "science": (
        "You are a research scientist. Evaluate the situation using the scientific method. "
        "Consider empirical evidence, hypotheses, experimental design, and theoretical frameworks."
    ),
    "business": (
        "You are a business strategist. Assess the situation from a business perspective. "
        "Consider market positioning, competitive landscape, operational efficiency, and growth potential."
    ),
    "ethics": (
        "You are an ethics advisor. Analyze the ethical implications of the situation. "
        "Consider moral principles, stakeholder impact, fairness, transparency, and accountability."
    ),
    "psychology": (
        "You are a psychologist. Examine the psychological factors at play. "
        "Consider cognitive biases, emotional responses, behavioral patterns, and mental health impacts."
    ),
    "sociology": (
        "You are a sociologist. Analyze the societal and cultural dimensions. "
        "Consider social structures, cultural norms, community impact, and demographic factors."
    ),
}

_VALID_DOMAINS: set[str] = set(get_args(DomainName))


class ExpertNode:
    def __init__(self, domain: str, hf_service: HFService) -> None:
        if domain not in _VALID_DOMAINS:
            raise ValueError(f"Unknown domain: {domain}")
        self.domain = domain
        self.system_prompt = DOMAIN_PROMPTS[domain]
        self.hf_service = hf_service

    async def analyze(self, situation: str) -> ExpertOutput:
        response, model = await self.hf_service.generate(self.system_prompt, situation)
        return ExpertOutput(
            domain=self.domain,
            analysis=response,
            confidence="medium",
            model_used=model,
            processing_time_ms=0,
        )
