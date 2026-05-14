from __future__ import annotations

import json
import logging
import re
from typing import Any

from backend.app.core.config import settings
from backend.app.services.hf_service import HFService

logger = logging.getLogger(__name__)

NODE_SELECTOR_SYSTEM_PROMPT = (
    "List 3 to 5 specific expert roles that would best analyze this question. "
    "Output one role per line, with a dash at the start. "
    "Example:\n"
    "- Cardiologist\n"
    "- Intensivist\n"
    "- Pharmacologist\n\n"
    "Choose roles that match the question domain precisely.\n"
    "Never use generic names like Medical, Business, Ethics.\n"
    "For clinical: Cardiologist, Intensivist, Pharmacologist, Nephrologist\n"
    "For legal: Legal Analyst, Judge, Defense Counsel, Prosecutor\n"
    "For engineering: Security Engineer, DevOps Lead, QA Engineer\n"
    "For business: CFO, Market Analyst, Investor\n"
    "For criminal: Evidence Analyst, Forensic Pathologist, Psychologist"
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

_ROLE_LINE_RE = re.compile(r"^[-*\d]+\.?\s+(.+)$", re.MULTILINE)
_BOLD_ROLE_RE = re.compile(r"\*\*([A-Za-z]+(?:\s+[A-Za-z]+)*?)\*\*")


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
            nodes = self._parse_response(response, situation)
            if nodes:
                return nodes
            logger.warning(
                "Node selection parse returned empty. Response: %.300s",
                response,
            )
        except Exception as e:
            logger.error("Node selection failed: %s", e)
            if response:
                logger.debug("Raw response on failure: %.300s", response)

        return self._fallback(situation)

    def _parse_response(self, text: str, situation: str) -> list[dict[str, str]] | None:
        names = self._extract_names(text)
        seen: set[str] = set()
        nodes: list[dict[str, str]] = []
        for name in names:
            if name.lower() in seen or not name:
                continue
            seen.add(name.lower())
            nodes.append(
                {
                    "name": name,
                    "role": _auto_role(name),
                    "behavior": _auto_behavior(name, situation),
                }
            )
        if len(nodes) >= 3:
            return nodes[:5]
        return None

    def _extract_names(self, text: str) -> list[str]:
        candidates = []

        dash_matches = _ROLE_LINE_RE.findall(text)
        for m in dash_matches:
            raw = m.strip()
            short = raw.split(":")[0].split(".")[0].split(",")[0].strip()
            if (
                short
                and len(short) <= 40
                and not short.startswith("NODE")
                and not short.startswith("System")
            ):
                candidates.append(short)

        if len(candidates) < 3:
            bold_matches = _BOLD_ROLE_RE.findall(text)
            for m in bold_matches:
                short = m.strip().rstrip(".:,")
                if 1 <= len(short.split()) <= 4 and len(short) <= 40:
                    candidates.append(short)

        if len(candidates) < 3:
            words = text.split()
            for i, w in enumerate(words):
                w_clean = w.strip("*#-:.,;!?")
                if (
                    w_clean
                    and w_clean[0].isupper()
                    and w_clean.isalpha()
                    and len(w_clean) > 3
                ):
                    if i + 1 < len(words):
                        next_w = words[i + 1].strip("*#-:.,;!?")
                        if next_w and next_w[0].isupper() and next_w.isalpha():
                            candidates.append(f"{w_clean} {next_w}")
                    candidates.append(w_clean)

        _SKIP = {
            "node",
            "detailed",
            "system",
            "prompt",
            "clinical",
            "expert",
            "given",
            "considering",
            "based",
            "role",
            "name",
            "behavior",
            "example",
            "output",
            "format",
            "rules",
            "select",
            "list",
            "choose",
            "never",
            "always",
            "each",
            "minimum",
            "maximum",
            "the",
            "this",
            "that",
            "with",
            "from",
            "would",
            "have",
            "they",
            "what",
            "analysis",
            "would",
            "should",
            "their",
            "them",
            "these",
        }

        filtered = []
        for n in candidates:
            cleaned = n.strip().strip("*#-:.,;!?").strip()
            words = cleaned.lower().split()
            if (
                1 <= len(words) <= 4
                and len(cleaned) <= 40
                and cleaned
                and not any(w in _SKIP for w in words)
                and cleaned[0].isupper()
            ):
                filtered.append(cleaned)

        seen: set[str] = set()
        unique: list[str] = []
        for n in filtered:
            key = n.lower().rstrip("s")
            if key not in seen:
                seen.add(key)
                unique.append(n)

        return unique

    def _fallback(self, situation: str) -> list[dict[str, str]]:
        logger.info("Using fallback nodes for situation: %.60s", situation)
        return DEFAULT_FALLBACK_NODES
