from __future__ import annotations

import json
import logging
import time

from app.core.config import settings
from app.graph.state import ExpertOutput
from app.schemas.node_output import (
    NodeOutput,
    clean_json_response,
    confidence_to_level,
    is_hallucinated,
)
from app.services.hf_service import HFService

logger = logging.getLogger(__name__)

DOMAIN_PROMPTS: dict[str, str] = {
    "legal": (
        "You are a pragmatic, precedent-driven senior counsel. You speak like a veteran "
        "attorney — methodical, precise, and grounded in case law. You always ask: 'What do "
        "the statutes and precedents say?' You flag risks clearly and recommend safeguards. "
        "Analyze the situation from a legal standpoint, covering regulations, liability, and rights."
    ),
    "finance": (
        "You are a cautious, numbers-first financial analyst. You think in spreadsheets and "
        "margins. Your instinct is to ask 'what are the hard numbers?' before making any claim. "
        "You are skeptical of unfounded optimism and always stress-test assumptions. "
        "Evaluate financial implications — costs, revenues, market conditions, and ROI."
    ),
    "medical": (
        "You are a risk-averse, evidence-based physician. Your guiding principle is 'first, do "
        "no harm.' You rely on peer-reviewed studies and clinical data. You are methodical, "
        "conservative in your recommendations, and quick to flag health risks. "
        "Assess health implications, symptoms, treatments, and public health impact."
    ),
    "technology": (
        "You are an optimistic yet pragmatic systems architect. You love elegant solutions but "
        "ground every idea in feasibility. You think in trade-offs — performance vs. cost, "
        "security vs. convenience. You always note integration risks and scalability limits. "
        "Analyze technical architecture, security, feasibility, and implementation risks."
    ),
    "education": (
        "You are a patient, development-focused educator. You see every situation as a learning "
        "opportunity. You care deeply about knowledge transfer, skill-building, and long-term "
        "growth. You ask 'how does this affect people's ability to learn and grow?' "
        "Examine educational dimensions — curricula, pedagogy, training needs, outcomes."
    ),
    "science": (
        "You are a skeptical, hypothesis-driven research scientist. You trust data, not anecdotes. "
        "You demand empirical evidence and reject claims that can't be falsified. Your favorite "
        "question is 'what does the data actually say?' You think in experiments and controls. "
        "Apply the scientific method — evidence, hypotheses, experimental design, theory."
    ),
    "business": (
        "You are a sharp, strategic business consultant. You see market dynamics and competitive "
        "plays everywhere. You think in moats, leverage, and unit economics. You are decisive but "
        "always hedge for downside risk. "
        "Assess market positioning, competitive landscape, operations, and growth strategy."
    ),
    "ethics": (
        "You are a principled, nuanced ethics advisor. You never take a binary view — you weigh "
        "stakeholder interests, fairness, transparency, and long-term societal impact. You channel "
        "Rawls and Kant but stay practical. Your motto: 'good ethics is good governance.' "
        "Analyze moral principles, stakeholder impact, fairness, and accountability."
    ),
    "psychology": (
        "You are an empathetic yet analytical psychologist. You read between the lines — "
        "cognitive biases, emotional drivers, defense mechanisms. You understand that people "
        "are irrational but predictable. You care about mental health and behavioral outcomes. "
        "Examine psychological factors — bias, emotion, behavior patterns, mental health."
    ),
    "sociology": (
        "You are a systems-oriented sociologist. You see society as interconnected structures — "
        "culture, class, institutions, power dynamics. You think in terms of norms, inequalities, "
        "and collective behavior. You ask: 'how does this ripple through society?' "
        "Analyze societal dimensions — social structures, cultural norms, community impact."
    ),
}

JSON_SCHEMA_SUFFIX = """
Respond ONLY in the following JSON schema. No preamble, no markdown fences, no explanation outside the JSON:
{
    "confidence": <integer 0-100>,
    "position": "<string>",
    "reasoning": "<string>",
    "key_findings": ["<string>", ...],
    "concerns": ["<string>", ...],
    "revision": null
}
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object. "
    "No preamble, no markdown fences, no explanation."
)


SUB_QUESTION_TEMPLATE = (
    'Answer this specific question:\n'
    '"{sub_question}"\n\n'
    'Use the situation below as context. Be specific, cite the numbers '
    'in the case, and take a clear position. Do not hedge.\n\n'
    'SITUATION: {situation}'
)


class ExpertNode:
    def __init__(
        self, domain: str, hf_service: HFService, behavior: str | None = None
    ) -> None:
        self.domain = domain
        base_prompt = behavior or DOMAIN_PROMPTS.get(
            domain, DOMAIN_PROMPTS["business"]
        )
        self.system_prompt = base_prompt + JSON_SCHEMA_SUFFIX
        self.hf_service = hf_service

    async def analyze(
        self, situation: str, sub_question: str | None = None, sub_question_id: str | None = None
    ) -> ExpertOutput:
        user_prompt = self._build_user_prompt(situation, sub_question)
        start = time.monotonic()
        node_output, model = await self._generate_node_output(user_prompt)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return self._to_expert_output(node_output, model, elapsed_ms, sub_question, sub_question_id)

    def _build_user_prompt(self, situation: str, sub_question: str | None) -> str:
        if sub_question:
            return SUB_QUESTION_TEMPLATE.format(
                sub_question=sub_question,
                situation=situation,
            )
        return situation

    async def _generate_node_output(
        self, situation: str, is_retry: bool = False
    ) -> tuple[NodeOutput | None, str]:
        """Generate and validate structured node output from the LLM.

        Attempts the generation once, then retries on validation or hallucination failure.
        Returns (NodeOutput, model) on success, or (None, model) on failure.
        """
        system = self.system_prompt
        if is_retry:
            system = self.system_prompt + RETRY_PROMPT

        response, model = await self.hf_service.generate(
            system,
            situation,
            max_tokens=settings.HF_EXPERT_MAX_TOKENS,
        )

        # Attempt to parse and validate
        parsed = self._try_parse(response)
        if parsed is None:
            if not is_retry:
                logger.warning(
                    "Expert %s: JSON parse failed, retrying once. Raw: %.200s",
                    self.domain,
                    response,
                )
                return await self._generate_node_output(situation, is_retry=True)
            logger.error(
                "Expert %s: JSON parse failed after retry. Marking as error.",
                self.domain,
            )
            return None, model

        # Check for hallucination
        if is_hallucinated(parsed):
            if not is_retry:
                logger.warning(
                    "Expert %s: Hallucination detected, retrying once.",
                    self.domain,
                )
                return await self._generate_node_output(situation, is_retry=True)
            logger.error(
                "Expert %s: Hallucination detected after retry. Marking as error.",
                self.domain,
            )
            return None, model

        return parsed, model

    def _try_parse(self, raw: str) -> NodeOutput | None:
        """Try to parse a raw string into a NodeOutput.

        Returns None if parsing or validation fails.
        """
        try:
            cleaned = clean_json_response(raw)
            data = json.loads(cleaned)
            return NodeOutput(**data)
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse expert response: %s", e)
            return None

    def _to_expert_output(
        self,
        node_output: NodeOutput | None,
        model: str,
        elapsed_ms: int = 0,
        sub_question: str | None = None,
        sub_question_id: str | None = None,
    ) -> ExpertOutput:
        """Convert a NodeOutput (or None for errors) to an ExpertOutput TypedDict.

        The `analysis` field is set to a human-readable formatted string for
        backward compatibility with the frontend renderer.
        """
        if node_output is None:
            return ExpertOutput(
                domain=self.domain,
                analysis="",
                confidence="low",
                model_used=model,
                processing_time_ms=elapsed_ms,
            )

        # Build a readable summary from structured fields for backward compat
        readable_analysis = (
            f"Position: {node_output.position}\n\n"
            f"Reasoning: {node_output.reasoning}\n\n"
            f"Key Findings:\n"
        )
        for i, finding in enumerate(node_output.key_findings, 1):
            readable_analysis += f"{i}. {finding}\n"
        if node_output.concerns:
            readable_analysis += "\nConcerns:\n"
            for concern in node_output.concerns:
                readable_analysis += f"- {concern}\n"

        result = ExpertOutput(
            domain=self.domain,
            analysis=readable_analysis,
            confidence=confidence_to_level(node_output.confidence),
            confidence_score=node_output.confidence,
            position=node_output.position,
            reasoning=node_output.reasoning,
            key_findings=node_output.key_findings,
            concerns=node_output.concerns,
            model_used=model,
            processing_time_ms=elapsed_ms,
        )
        if sub_question:
            result["sub_question"] = sub_question
        if sub_question_id:
            result["sub_question_id"] = sub_question_id
        return result
