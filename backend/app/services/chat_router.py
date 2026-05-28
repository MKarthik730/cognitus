"""
Chat Router — post-analysis canvas chat system.

After analysis completes, the canvas becomes conversational. Users ask follow-up
questions in natural language. System routes the question to the most relevant node,
which responds in character.

Node routing:
  - "Why did the legal expert disagree?" → legal expert node responds
  - "What's the biggest risk here?" → synthesizer responds
  - "Explain the contradiction between finance and HR" → cross-check node responds
  - "Give me more detail on point 3" → relevant expert node responds
  - "What would change your verdict?" → synthesizer responds
  - "Walk me through your reasoning" → distributor responds
  - General/unclear → synthesizer (default)

Single LLM call per question — never reruns the full pipeline.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator

from app.schemas.node_output import clean_json_response
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)


ROUTER_CLASSIFIER_PROMPT = """\
You are a chat router for a multi-expert analysis system called Cognitus.
Given a user's follow-up question and the context of a completed analysis, determine
which expert node should respond.

Available nodes:
- distributor: The system that selected which experts to analyze
- cross_check: The system that found contradictions and agreements between experts
- synthesizer: The system that produced the final verdict
- {expert_list}: Individual expert domains from the analysis

Rules:
- If question references a specific expert domain ("legal", "finance", etc.), route to that expert
- If question asks about contradictions/disagreements, route to "cross_check"
- If question asks about verdict, confidence, or general analysis, route to "synthesizer"
- If question asks about reasoning process or methodology, route to "distributor"
- Otherwise, default to "synthesizer"

Respond ONLY with JSON:
{
    "node_name": "<node_name>",
    "node_persona": "<brief description of how this node should respond>",
    "reason": "<why this node was selected>"
}
"""


NODE_PERSONAS: dict[str, str] = {
    "distributor": "You are the distributor — the system that selected which experts to consult. Explain your reasoning process and why specific domains were chosen.",
    "cross_check": "You are the cross-check analyst — you found contradictions and agreements between experts. Speak as an impartial mediator who sees all perspectives.",
    "synthesizer": "You are the chief synthesizer — the voice of the council. Speak with the full authority of the completed analysis, integrating all expert perspectives.",
}


class ChatRouter:
    """Routes follow-up questions to the correct expert node and generates responses."""

    def __init__(self) -> None:
        self._router = get_llm_router()

    async def determine_node(
        self,
        question: str,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        """Determine which node should respond to a question.

        This is the first step of the two-step chat pipeline used by
        websocket.py. Returns routing info with node_name, node_persona, reason.
        """
        return await self._classify_question(question, analysis_context)

    async def stream_response(
        self,
        question: str,
        routing: dict[str, Any],
        analysis_context: dict[str, Any],
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response from the selected node.

        Yields tokens one by one for real-time display in the chat panel.
        Delegates to _generate_node_response() to avoid code duplication.
        """
        node_name = routing.get("node_name", "synthesizer")
        persona = routing.get("node_persona", NODE_PERSONAS.get(node_name, ""))

        try:
            response = await self._generate_node_response(
                node_name=node_name,
                persona=persona,
                question=question,
                analysis_context=analysis_context,
                chat_history=[],
            )
            # Yield the response as words (simulated streaming)
            words = response.strip().split()
            for i, word in enumerate(words):
                token = word + (" " if i < len(words) - 1 else "")
                yield token
        except Exception as e:
            logger.error("Chat response generation failed: %s", e)
            yield f"I apologize, but I encountered an error generating a response."

    async def _classify_question(
        self,
        question: str,
        analysis_context: dict[str, Any],
    ) -> dict[str, Any]:
        """Classify a question to determine which node should respond."""
        # Build expert list from analysis context
        expert_domains = []
        if "experts" in analysis_context:
            if isinstance(analysis_context["experts"], list):
                expert_domains = [e.get("domain", "") for e in analysis_context["experts"]]
            elif isinstance(analysis_context["experts"], dict):
                expert_domains = list(analysis_context["experts"].keys())

        expert_list_str = ", ".join(expert_domains) if expert_domains else "individual experts"

        classifier_prompt = ROUTER_CLASSIFIER_PROMPT.format(expert_list=expert_list_str)
        analysis_summary = self._build_context_summary(analysis_context)

        try:
            response, _ = await self._router.generate(
                classifier_prompt,
                f"Question: {question}\n\nAnalysis context:\n{analysis_summary}\n\nAvailable expert domains: {expert_list_str}",
                max_tokens=256,
            )
            cleaned = clean_json_response(response)
            route_data = json.loads(cleaned)
        except Exception as e:
            logger.warning("Chat routing failed, defaulting to synthesizer: %s", e)
            route_data = {"node_name": "synthesizer", "node_persona": NODE_PERSONAS.get("synthesizer", ""), "reason": "Default fallback"}

        node_name = route_data.get("node_name", "synthesizer")
        persona = route_data.get("node_persona", NODE_PERSONAS.get(node_name, ""))

        return {
            "node_name": node_name,
            "node_persona": persona,
            "reason": route_data.get("reason", ""),
        }

    async def route_question(
        self,
        question: str,
        analysis_context: dict[str, Any],
        chat_history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Route a user question to the most relevant node and get a response."""
        # Build expert list from analysis context
        expert_domains = []
        if "experts" in analysis_context:
            if isinstance(analysis_context["experts"], list):
                expert_domains = [e.get("domain", "") for e in analysis_context["experts"]]
            elif isinstance(analysis_context["experts"], dict):
                expert_domains = list(analysis_context["experts"].keys())

        expert_list_str = ", ".join(expert_domains) if expert_domains else "individual experts"

        # Determine which node should respond
        classifier_prompt = ROUTER_CLASSIFIER_PROMPT.format(expert_list=expert_list_str)
        analysis_summary = self._build_context_summary(analysis_context)

        try:
            response, _ = await self._router.generate(
                classifier_prompt,
                f"Question: {question}\n\nAnalysis context:\n{analysis_summary}\n\nAvailable expert domains: {expert_list_str}",
                max_tokens=256,
            )
            cleaned = clean_json_response(response)
            route_data = json.loads(cleaned)
        except Exception as e:
            logger.warning("Chat routing failed, defaulting to synthesizer: %s", e)
            route_data = {"node_name": "synthesizer", "node_persona": NODE_PERSONAS.get("synthesizer", ""), "reason": "Default fallback"}

        node_name = route_data.get("node_name", "synthesizer")
        persona = route_data.get("node_persona", NODE_PERSONAS.get(node_name, ""))

        # Generate response from the selected node
        response_text = await self._generate_node_response(
            node_name=node_name,
            persona=persona,
            question=question,
            analysis_context=analysis_context,
            chat_history=chat_history or [],
        )

        return {
            "node": node_name,
            "persona": persona,
            "response": response_text,
            "routing_reason": route_data.get("reason", ""),
        }

    async def _generate_node_response(
        self,
        node_name: str,
        persona: str,
        question: str,
        analysis_context: dict[str, Any],
        chat_history: list[dict[str, str]],
    ) -> str:
        """Generate a response from a specific node in its persona."""
        system_prompt = f"""\
{persona or NODE_PERSONAS.get(node_name, "You are an expert analyst responding to a follow-up question.")}

IMPORTANT RULES:
1. Respond in character — stay true to your role in the analysis
2. Reference specific findings, numbers, and contradictions from the original analysis
3. Be concise but thorough
4. Do not fabricate facts not present in the analysis
5. If you don't have enough information, say so clearly

The following is the complete analysis context. Reference it in your response.
"""

        context = self._build_context_summary(analysis_context)
        chat_history_str = ""
        if chat_history:
            chat_history_str = "\n\nPrevious conversation:\n" + "\n".join(
                f"User: {m.get('question', '')}\nResponse: {m.get('response', '')}"
                for m in chat_history[-5:]  # Last 5 exchanges
            )

        user_prompt = f"Analysis context:\n{context}\n{chat_history_str}\n\nFollow-up question: {question}"

        try:
            response, _ = await self._router.generate(
                system_prompt, user_prompt, max_tokens=1024
            )
            return response.strip()
        except Exception as e:
            logger.error("Chat response generation failed: %s", e)
            return f"I apologize, but I encountered an error generating a response. Please try rephrasing your question."

    def _build_context_summary(self, ctx: dict[str, Any]) -> str:
        """Build a concise summary of the analysis context for the LLM."""
        parts = []

        if "verdict" in ctx:
            parts.append(f"Verdict: {ctx.get('verdict', '')}")
        if "synthesis" in ctx:
            if isinstance(ctx["synthesis"], dict):
                parts.append(f"Verdict: {ctx['synthesis'].get('verdict', '')}")
                parts.append(f"Confidence: {ctx['synthesis'].get('confidence', '')}")
                parts.append(f"Consensus Score: {ctx['synthesis'].get('consensus_score', 0)}")

        if "consensus_score" in ctx:
            parts.append(f"Consensus Score: {ctx.get('consensus_score', 0.5)}")

        if "experts" in ctx:
            if isinstance(ctx["experts"], list):
                for e in ctx["experts"]:
                    parts.append(f"Expert {e.get('domain', '')}: {e.get('position', e.get('analysis', ''))[:200]}")
            elif isinstance(ctx["experts"], dict):
                for domain, data in ctx["experts"].items():
                    pos = data.get("position", data.get("analysis", ""))
                    if isinstance(pos, str):
                        parts.append(f"Expert {domain}: {pos[:200]}")

        if "contradictions" in ctx and ctx["contradictions"]:
            parts.append(f"Contradictions found: {len(ctx['contradictions'])}")

        if "agreements" in ctx and ctx["agreements"]:
            parts.append(f"Agreements found: {len(ctx['agreements'])}")

        return "\n".join(parts[:20])  # Limit context length
