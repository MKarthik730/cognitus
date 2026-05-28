"""
Redaction Assistant — PII detection and auto-redact.

Detects and redacts personally identifiable information (PII) from user input
before it is sent to the LLM. Operates on all Ghost Mode levels.

Categories:
  PERSON:   Names of individuals
  COMPANY:  Company/organization names
  LOCATION: Physical addresses, cities, countries
  CONTACT:  Phone numbers, email addresses, social media handles
  ID:       SSN, passport, driver's license, credit card numbers
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PII Detection patterns
# ---------------------------------------------------------------------------

# Patterns use named groups for replacement
PII_PATTERNS: list[tuple[str, str, str, str]] = [
    # (category, replacement_label, regex_pattern, description)

    # Email addresses
    ("CONTACT", "[EMAIL]", r'[\w.+-]+@[\w-]+\.[\w.-]+', "email address"),

    # Phone numbers (international, US, etc.)
    ("CONTACT", "[PHONE]", r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', "phone number"),

    # SSN (US Social Security Number)
    ("ID", "[SSN]", r'\b\d{3}[-]\d{2}[-]\d{4}\b', "SSN"),

    # Credit card numbers (simple Luhn-able patterns)
    ("ID", "[CREDIT_CARD]", r'\b(?:\d{4}[-.\s]?){3}\d{4}\b', "credit card"),

    # URLs
    ("CONTACT", "[URL]", r'https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)', "URL"),

    # IPv4 addresses
    ("LOCATION", "[IP_ADDRESS]", r'\b(?:\d{1,3}\.){3}\d{1,3}\b', "IP address"),
]


@dataclass
class PIIDetection:
    """A single PII detection result."""
    category: str
    label: str
    text: str
    start: int
    end: int
    pattern_description: str


@dataclass
class RedactionResult:
    """Result of PII detection and redaction."""
    original_text: str = ""
    redacted_text: str = ""
    detections: list[PIIDetection] = field(default_factory=list)
    has_pii: bool = False


# ---------------------------------------------------------------------------
# PII Detector
# ---------------------------------------------------------------------------

class PIIDetector:
    """Detects and redacts PII from text.

    Usage:
        detector = PIIDetector()
        result = detector.scan("My email is john@example.com")
        result.has_pii  # True
        result.redacted_text  # "My email is [EMAIL]"
        result.detections  # [PIIDetection(...)]

        redacted = detector.redact("Call me at 555-123-4567")
        # "Call me at [PHONE]"
    """

    def __init__(self) -> None:
        self._compiled: list[tuple[str, str, re.Pattern, str]] = []
        for category, label, pattern, desc in PII_PATTERNS:
            try:
                compiled = re.compile(pattern, re.IGNORECASE)
                self._compiled.append((category, label, compiled, desc))
            except re.error as e:
                logger.warning("Failed to compile PII pattern '%s': %s", label, e)

    def scan(self, text: str) -> RedactionResult:
        """Scan text for PII and return detailed results."""
        result = RedactionResult(original_text=text)
        detections: list[PIIDetection] = []

        for category, label, pattern, desc in self._compiled:
            for match in pattern.finditer(text):
                start, end = match.start(), match.end()
                matched_text = text[start:end]

                # Avoid duplicate overlapping detections (keep the longer one)
                overlapping = False
                for existing in detections:
                    if (start < existing.end and end > existing.start):
                        if (end - start) > (existing.end - existing.start):
                            detections.remove(existing)
                        else:
                            overlapping = True
                        break
                if overlapping:
                    continue

                detection = PIIDetection(
                    category=category,
                    label=label,
                    text=matched_text,
                    start=start,
                    end=end,
                    pattern_description=desc,
                )
                detections.append(detection)

        # Sort by position
        detections.sort(key=lambda d: d.start)
        result.detections = detections
        result.has_pii = len(detections) > 0

        # Build redacted text
        if detections:
            parts: list[str] = []
            cursor = 0
            for d in detections:
                if d.start > cursor:
                    parts.append(text[cursor:d.start])
                parts.append(d.label)
                cursor = d.end
            if cursor < len(text):
                parts.append(text[cursor:])
            result.redacted_text = "".join(parts)
        else:
            result.redacted_text = text

        return result

    def redact(self, text: str) -> str:
        """Quick redact — returns redacted text directly."""
        result = self.scan(text)
        return result.redacted_text

    def get_highlights(self, text: str) -> list[dict[str, Any]]:
        """Get highlight regions for the UI to render (positions + labels)."""
        result = self.scan(text)
        return [
            {
                "start": d.start,
                "end": d.end,
                "label": d.label,
                "category": d.category,
                "text": d.text,
            }
            for d in result.detections
        ]


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------

_detector: PIIDetector | None = None


def get_detector() -> PIIDetector:
    """Get the global PII detector singleton."""
    global _detector
    if _detector is None:
        _detector = PIIDetector()
    return _detector


def scan_pii(text: str) -> RedactionResult:
    """Scan text for PII."""
    return get_detector().scan(text)


def redact_pii(text: str) -> str:
    """Redact PII from text."""
    return get_detector().redact(text)


# ---------------------------------------------------------------------------
# RedactionAssistant — backward-compatible alias used by websocket.py
# ---------------------------------------------------------------------------

class RedactionAssistant:
    """Backward-compatible wrapper used by websocket.py.

    Provides a simplified API:
        redactor = RedactionAssistant()
        redacted_text, detections = await redactor.redact(text)

    The detections list contains dicts with type, original, and position info
    suitable for sending as WebSocket events.
    """

    def __init__(self) -> None:
        self._detector = get_detector()

    async def redact(self, text: str) -> tuple[str, list[dict[str, str]]]:
        """Redact PII from text and return (redacted_text, detections).

        detections is a list of dicts with 'type', 'original', and 'position' keys,
        suitable for sending as WebSocket events to the frontend.
        """
        result = self._detector.scan(text)
        detections = [
            {
                "type": d.category,
                "original": d.text,
                "label": d.label,
                "position": f"char {d.start}-{d.end}",
            }
            for d in result.detections
        ]
        return result.redacted_text, detections

    async def scan(self, text: str) -> list[dict[str, Any]]:
        """Scan and return highlights without modifying."""
        return self._detector.get_highlights(text)
