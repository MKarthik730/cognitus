"""The deterministic verification layer — facts, no LLM.

Every module here returns app.schemas.verdict_output.DeterministicCheckResult
objects built from tool output or plain computation. None of them call an
LLM, and none of them are allowed to "interpret" — they pass through what
the underlying check actually found.
"""
