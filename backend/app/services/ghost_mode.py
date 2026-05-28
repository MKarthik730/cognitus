"""
Ghost Mode — 4-level privacy enforcement system.

Levels:
  Fog:     Redis TTL only, no PostgreSQL writes
  Shadow:  Backend memory only — zero Redis, zero PostgreSQL, zero access logs
  Void:    Forces LOCAL mode (Ollama), nothing leaves device
  Phantom: Forces BROWSER mode (WebLLM), zero network requests

Privacy is architecturally enforced at the service layer — not just a flag.
"""

from __future__ import annotations

import hashlib
import logging
from enum import Enum
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class GhostLevel(str, Enum):
    OFF = "off"
    FOG = "fog"
    SHADOW = "shadow"
    VOID = "void"
    PHANTOM = "phantom"


# ---------------------------------------------------------------------------
# Transparency disclosure messages
# ---------------------------------------------------------------------------

GHOST_DISCLOSURES: dict[GhostLevel, dict[str, str]] = {
    GhostLevel.FOG: {
        "title": "Fog Mode",
        "description": "Cognitus doesn't store it ✓",
        "detail": "LLM provider may log it ⚠️",
    },
    GhostLevel.SHADOW: {
        "title": "Shadow Mode",
        "description": "Cognitus doesn't store it ✓",
        "detail": "LLM provider may log it ⚠️",
    },
    GhostLevel.VOID: {
        "title": "Void Mode",
        "description": "Nothing leaves your device ✓✓",
        "detail": "Completely private ✓✓",
    },
    GhostLevel.PHANTOM: {
        "title": "Phantom Mode",
        "description": "Nothing leaves your browser tab ✓✓✓",
        "detail": "Not even Cognitus servers see it ✓✓✓",
    },
}


# ---------------------------------------------------------------------------
# Ghost mode enforcement
# ---------------------------------------------------------------------------

class GhostModeEnforcer:
    """Enforces ghost mode privacy guarantees at the service layer.

    Usage:
        enforcer = GhostModeEnforcer(GhostLevel.FOG)
        enforcer.assert_can_write_to_db()     # raises if Shadow+
        enforcer.assert_can_write_to_redis()   # raises if Shadow+
        enforcer.assert_external_api_allowed() # raises if Void+
        enforcer.get_llm_mode_override()       # returns forced LLM mode
    """

    def __init__(self, level: GhostLevel | str = GhostLevel.OFF) -> None:
        if isinstance(level, str):
            try:
                self.level = GhostLevel(level.lower())
            except ValueError:
                logger.warning("Unknown ghost level '%s', defaulting to OFF", level)
                self.level = GhostLevel.OFF
        else:
            self.level = level

    # ------------------------------------------------------------------
    # Enforcement methods — raise when level prohibits the operation
    # ------------------------------------------------------------------

    def assert_can_write_to_db(self) -> None:
        """No PostgreSQL writes allowed in Fog+ (all ghost levels)."""
        if self.level != GhostLevel.OFF:
            raise GhostWriteError(
                f"Ghost Mode ({self.level.value}) does not persist data to PostgreSQL. "
                "This is architecturally enforced."
            )

    def assert_can_write_to_redis(self) -> None:
        """No Redis writes in Shadow+."""
        if self.level in (GhostLevel.SHADOW, GhostLevel.VOID, GhostLevel.PHANTOM):
            raise GhostWriteError(
                f"Ghost Mode ({self.level.value}) does not write to Redis. "
                "This is architecturally enforced."
            )

    def assert_can_log_access(self) -> None:
        """No access logs in Shadow+."""
        if self.level in (GhostLevel.SHADOW, GhostLevel.VOID, GhostLevel.PHANTOM):
            raise GhostWriteError(
                f"Ghost Mode ({self.level.value}) does not log access. "
                "This is architecturally enforced."
            )

    def assert_external_api_allowed(self) -> None:
        """No external API calls in Void or Phantom."""
        if self.level in (GhostLevel.VOID, GhostLevel.PHANTOM):
            raise GhostExternalAPIError(
                f"Ghost Mode ({self.level.value}) prohibits external API calls. "
                f"Nothing leaves your device."
            )

    # ------------------------------------------------------------------
    # Override methods
    # ------------------------------------------------------------------

    def get_llm_mode_override(self) -> str | None:
        """Return the LLM mode that ghost level forces, or None.

        Void     → forces "local" (Ollama only)
        Phantom  → forces "browser" (WebLLM only)
        Others   → no override (user's LLM mode setting respected)
        """
        if self.level == GhostLevel.VOID:
            return "local"
        if self.level == GhostLevel.PHANTOM:
            return "browser"
        return None

    def should_persist_to_db(self) -> bool:
        """Should we persist analysis results to PostgreSQL?"""
        return self.level == GhostLevel.OFF

    def should_persist_to_redis(self) -> bool:
        """Should we persist events to Redis?"""
        return self.level in (GhostLevel.OFF, GhostLevel.FOG)

    def should_log_analytics(self) -> bool:
        """Should we log analytics/usage data?"""
        return self.level == GhostLevel.OFF

    # ------------------------------------------------------------------
    # Ghost ID (rate limiting without identity)
    # ------------------------------------------------------------------

    @staticmethod
    def compute_ghost_id(ip_address: str, user_agent: str, session_timestamp: str) -> str:
        """Compute a non-identifiable ghost ID for rate limiting.

        Uses a one-way hash of ip + user_agent + session_timestamp.
        The timestamp ensures the hash changes each session.
        """
        raw = f"{ip_address}|{user_agent}|{session_timestamp}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    # ------------------------------------------------------------------
    # API response helpers
    # ------------------------------------------------------------------

    def get_disclosure(self) -> dict[str, str]:
        """Get the transparency disclosure for the current ghost level."""
        return GHOST_DISCLOSURES.get(self.level, {
            "title": "Standard Mode",
            "description": "Data is stored normally",
            "detail": "Your data is stored in PostgreSQL and Redis",
        })

    async def can_analyze(self, level_str: str | None = None) -> tuple[bool, str]:
        """Check if analysis is allowed at the given ghost level.

        Returns (can_proceed, restriction_message).
        This is the API used by websocket.py's analysis handlers.
        """
        level = self.level
        if level_str:
            try:
                level = GhostLevel(level_str.lower())
            except ValueError:
                level = GhostLevel.OFF

        if level in (GhostLevel.VOID, GhostLevel.PHANTOM):
            # Validate that the forced LLM mode is available
            override = self.get_override_for_level(level)
            if override == "local":
                # Check if Ollama is running (async HTTP)
                import httpx
                try:
                    async with httpx.AsyncClient(timeout=3) as client:
                        base_url = settings.OLLAMA_BASE_URL or "http://localhost:11434"
                        r = await client.get(f"{base_url}/api/tags")
                        if r.status_code != 200:
                            return False, f"{level.value.title()} Mode requires Ollama at {base_url}, but it is not responding."
                except Exception:
                    return False, f"{level.value.title()} Mode requires Ollama at {base_url or 'http://localhost:11434'}, but it is not reachable."
            elif override == "browser":
                # Browser mode always allowed (WebLLM runs client-side)
                pass

        return True, ""

    @staticmethod
    def get_override_for_level(level: GhostLevel) -> str | None:
        if level == GhostLevel.VOID:
            return "local"
        if level == GhostLevel.PHANTOM:
            return "browser"
        return None

    def get_disclosure_for_level(self, level_str: str) -> dict[str, str]:
        """Get transparency disclosure for a specific ghost level (by string)."""
        try:
            level = GhostLevel(level_str.lower())
            return GHOST_DISCLOSURES.get(level, {
                "title": "Custom Mode",
                "description": "Privacy protection active",
                "detail": "",
            })
        except ValueError:
            return {
                "title": "Standard Mode",
                "description": "Data is stored normally",
                "detail": "Your data is stored in PostgreSQL and Redis",
            }

    def get_ui_state(self) -> dict[str, Any]:
        """Get UI state for the frontend ghost indicator."""
        return {
            "level": self.level.value,
            "isGhost": self.level != GhostLevel.OFF,
            "disclosure": self.get_disclosure(),
            "ttl": "1 hour" if self.level == GhostLevel.FOG else None,
            "llmOverride": self.get_llm_mode_override(),
            "canDownload": self.level == GhostLevel.OFF or self.level == GhostLevel.FOG,
        }


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Alias: GhostModeManager for backward compatibility with websocket.py
# ---------------------------------------------------------------------------

class GhostModeManager:
    """Legacy alias for GhostModeEnforcer. Delegates all calls.

    This alias exists for backward compatibility with the websocket.py
    integration which was written against this name.
    """

    def __init__(self) -> None:
        self._enforcer: GhostModeEnforcer | None = None
        self._get_or_create()

    def _get_or_create(self) -> GhostModeEnforcer:
        if self._enforcer is None:
            level = settings.GHOST_MODE or GhostLevel.OFF.value
            self._enforcer = GhostModeEnforcer(level=level)
        return self._enforcer

    async def can_analyze(self, level_str: str = "off") -> tuple[bool, str]:
        enforcer = GhostModeEnforcer(level=level_str)
        return await enforcer.can_analyze(level_str)

    def get_llm_override(self, level_str: str) -> str | None:
        try:
            level = GhostLevel(level_str.lower())
            return GhostModeEnforcer.get_override_for_level(level)
        except ValueError:
            return None

    def get_disclosure(self, level_str: str) -> dict[str, str]:
        return GhostModeEnforcer(level="off").get_disclosure_for_level(level_str)


class GhostWriteError(Exception):
    """Raised when ghost mode prevents a write operation."""
    pass


class GhostExternalAPIError(Exception):
    """Raised when ghost mode prevents an external API call."""
    pass


# ---------------------------------------------------------------------------
# Singleton / helpers
# ---------------------------------------------------------------------------

_ghost_enforcer: GhostModeEnforcer | None = None


def get_ghost_enforcer() -> GhostModeEnforcer:
    """Get or create the global ghost enforcer."""
    global _ghost_enforcer
    if _ghost_enforcer is None:
        level = settings.GHOST_MODE or GhostLevel.OFF.value
        _ghost_enforcer = GhostModeEnforcer(level=level)
    return _ghost_enforcer


def set_ghost_level(level: str) -> GhostModeEnforcer:
    """Set ghost level at runtime (e.g. from WebSocket message)."""
    global _ghost_enforcer
    _ghost_enforcer = GhostModeEnforcer(level=level)
    return _ghost_enforcer
