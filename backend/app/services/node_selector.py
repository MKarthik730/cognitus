from __future__ import annotations

import json
import logging
from typing import Any

from backend.app.core.config import settings
from backend.app.schemas.node_output import clean_json_response
from backend.app.services.hf_service import HFService

logger = logging.getLogger(__name__)

NODE_SELECTOR_SYSTEM_PROMPT = """
List 3 to 5 specific expert roles that would best analyze this question.
Choose roles that match the question domain precisely.

For clinical: Cardiologist, Intensivist, Pharmacologist, Nephrologist
For legal: Legal Analyst, Judge, Defense Counsel, Prosecutor
For engineering: Security Engineer, DevOps Lead, QA Engineer
For business: CFO, Market Analyst, Investor
For criminal: Evidence Analyst, Forensic Pathologist, Psychologist

Respond ONLY with a JSON object. No preamble, no markdown fences, no explanation outside the JSON:
{
    "nodes": [
        {
            "name": "<role name, e.g. Cardiologist>",
            "role": "<one-line description of the role>",
            "behavior": "<detailed system prompt describing how this role should reason>"
        }
    ]
}

Each node entry must have:
- name: The specific role title (e.g. "Cardiologist", not "Medical")
- role: A concise one-line description of what this expert does
- behavior: A detailed system prompt (2-3 sentences) describing how this expert should analyze, what to focus on, and what style to use
"""

RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object."
)

DEFAULT_FALLBACK_NODES = [
    {
        "name": "Analyst",
        "role": "Provides objective data-driven analysis of the situation",
        "behavior": (
            "You are a neutral, data-driven analyst. Evaluate the situation "
            "objectively, presenting facts, data patterns, and logical conclusions. "
            "Avoid bias and focus on empirical evidence."
        ),
    },
    {
        "name": "Critic",
        "role": "Challenges assumptions and stress-tests the reasoning",
        "behavior": (
            "You are a rigorous critic. Your job is to challenge every assumption, "
            "identify logical fallacies, and stress-test the argument from all angles. "
            "Be blunt but constructive."
        ),
    },
    {
        "name": "Synthesist",
        "role": "Integrates perspectives into a balanced conclusion",
        "behavior": (
            "You are a synthesist who integrates multiple viewpoints. Weigh evidence "
            "from all sides, reconcile contradictions, and produce a balanced assessment "
            "that acknowledges complexity while pointing toward actionable conclusions."
        ),
    },
]


def _auto_role(name: str) -> str:
    return f"Provides expert {name.lower()} analysis of the situation"


def _auto_behavior(name: str, situation: str) -> str:
    domain_hint = situation[:80].rstrip(".!?")
    return (
        f"You are a senior {name.lower()}. Analyze the following scenario "
        f'from your professional perspective: "{domain_hint}." '
        f"Be specific, cite evidence, and provide actionable recommendations. "
        f"Flag critical issues and red flags immediately."
    )


class NodeSelector:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service

    async def select_nodes(self, situation: str) -> list[dict[str, str]]:
        response = None
        try:
            response, _model = await self.hf_service.generate(
                NODE_SELECTOR_SYSTEM_PROMPT,
                situation,
                max_tokens=settings.HF_NODE_SELECTOR_MAX_TOKENS,
            )
            logger.debug("Raw node selector response: %.200s", response)

            nodes = self._parse_json_response(response, situation)
            if nodes:
                return nodes

            logger.warning("Node selection JSON parse returned empty, retrying...")
            # Retry once
            response2, _model2 = await self.hf_service.generate(
                NODE_SELECTOR_SYSTEM_PROMPT + RETRY_PROMPT,
                situation,
                max_tokens=settings.HF_NODE_SELECTOR_MAX_TOKENS,
            )
            if response2:
                nodes = self._parse_json_response(response2, situation)
                if nodes:
                    return nodes

            logger.warning("Node selection JSON parse empty after retry.")

            # Before giving up completely, try to extract domain names from raw text
            if response:
                extracted = self._extract_nodes_from_text(response, situation)
                if extracted:
                    logger.info("Recovered nodes via text extraction fallback")
                    return extracted
            if response2:
                extracted = self._extract_nodes_from_text(response2, situation)
                if extracted:
                    logger.info("Recovered nodes via text extraction fallback (retry)")
                    return extracted
        except Exception as e:
            logger.error("Node selection failed: %s", e)
            if response:
                logger.debug("Raw response on failure: %.300s", response)

        return self._fallback(situation)

    def _extract_nodes_from_text(
        self, text: str, situation: str
    ) -> list[dict[str, str]] | None:
        """Fallback: extract domain names from raw text when JSON parsing fails.

        Uses simple heuristics to pull out role names (capitalized words or
        phrases that match known domain patterns) from the LLM output.
        """
        import re

        # Known domain role patterns to look for
        KNOWN_ROLES = [
            "Cardiologist", "Intensivist", "Pharmacologist", "Nephrologist",
            "Legal Analyst", "Judge", "Defense Counsel", "Prosecutor",
            "Security Engineer", "DevOps Lead", "QA Engineer", "Network Engineer",
            "CFO", "Market Analyst", "Investor", "Financial Analyst",
            "Evidence Analyst", "Forensic Pathologist", "Psychologist",
            "Data Scientist", "Machine Learning Engineer", "Product Manager",
            "Ethicist", "Sociologist", "Policy Advisor", "Statistician",
            "Epidemiologist", "Public Health Expert", "Logistics Coordinator",
            "Supply Chain Manager", "HR Specialist", "Operations Lead",
        ]

        found: list[str] = []
        lower_text = text.lower()

        for role in KNOWN_ROLES:
            if role.lower() in lower_text:
                found.append(role)

        # Also try to find bullet-pointed or numbered role names
        # Look for lines that start with - or * or digit. followed by a capitalized name
        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            # Match lines like "- Cardiologist", "1. Cardiologist", "* Cardiologist"
            m = re.match(r"^[\s*\-\d\.]+\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)", stripped)
            if m:
                name = m.group(1).strip()
                if name and not any(name.lower() == f.lower() for f in found):
                    # Avoid catching generic words
                    if len(name) > 2 and name.lower() not in ("the", "this", "that", "with", "from", "each"):
                        found.append(name)

        if len(found) >= 2:
            nodes: list[dict[str, str]] = []
            seen: set[str] = set()
            for name in found[:5]:
                clean_name = name.strip().rstrip(".:,")
                if clean_name.lower() in seen:
                    continue
                seen.add(clean_name.lower())
                nodes.append({
                    "name": clean_name,
                    "role": _auto_role(clean_name),
                    "behavior": _auto_behavior(clean_name, situation),
                })
            if len(nodes) >= 2:
                logger.info("Fallback text extraction yielded %d nodes from raw LLM output", len(nodes))
                return nodes

        return None

    def _parse_json_response(
        self, text: str | None, situation: str
    ) -> list[dict[str, str]] | None:
        """Parse JSON node selector response into node list."""
        if not text:
            return None

        try:
            cleaned = clean_json_response(text)
            data = json.loads(cleaned)
            raw_nodes = data.get("nodes", [])

            if not raw_nodes or not isinstance(raw_nodes, list):
                return None

            nodes: list[dict[str, str]] = []
            seen: set[str] = set()

            for item in raw_nodes:
                name = item.get("name", "").strip()
                if not name or name.lower() in seen:
                    continue
                seen.add(name.lower())

                role = item.get("role", "").strip() or _auto_role(name)
                behavior = item.get("behavior", "").strip() or _auto_behavior(
                    name, situation
                )

                nodes.append(
                    {
                        "name": name,
                        "role": role,
                        "behavior": behavior,
                    }
                )

            if len(nodes) >= 2:
                return nodes[:5]

            return None

        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.debug("Failed to parse node selector JSON: %s", e)
            return None

    def _fallback(self, situation: str) -> list[dict[str, str]]:
        logger.info("Using fallback nodes for situation: %.60s", situation)
        return DEFAULT_FALLBACK_NODES
