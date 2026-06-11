"""
Prompt injection guard for custom node instructions.

Validates that user-supplied instructions do not contain prompt injection
attempts, system prompt overrides, or jailbreak patterns.
"""

import re
from collections import Counter
from typing import Optional


# Patterns that indicate prompt injection attempts
INJECTION_PATTERNS: list[re.Pattern] = [
    # System prompt override attempts
    re.compile(r"ignore\s+(all\s+)?(previous|above|below|prior)\s+(instructions|directives|commands)", re.IGNORECASE),
    re.compile(r"(forget|disregard|override|bypass)\s+(all\s+)?(previous|above|below|prior)", re.IGNORECASE),
    re.compile(r"(new\s+)?system\s+(prompt|instruction|message)", re.IGNORECASE),
    
    # Role hijacking
    re.compile(r"you\s+are\s+(now|not)\s+(a|an|the)?\s*((system|assistant|AI|GPT)", re.IGNORECASE),
    re.compile(r"act\s+as\s+(if\s+)?(you\s+are\s+)?(the\s+)?(system|admin|developer)", re.IGNORECASE),
    
    # Delimiter breaking
    re.compile(r"ignore\s+the\s+(above|below|instructions|prompt)", re.IGNORECASE),
    re.compile(r"(ignore|disregard)\s+(everything|all)\s+(above|before|below)", re.IGNORECASE),
    
    # Output formatting jailbreaks
    re.compile(r"output\s+(in\s+)?raw\s+(text|format|JSON?|mode)", re.IGNORECASE),
    re.compile(r"do\s+not\s+(follow|obey|adhere\s+to)", re.IGNORECASE),
    
    # Common jailbreak prefixes
    re.compile(r"^(simulate|pretend|imagine)\s+(that\s+)?(you\s+are|we\s+are)", re.IGNORECASE),
    re.compile(r"(DAN|jailbreak|prompt\s+injection|pwn|hack|exploit)", re.IGNORECASE),
    
    # Code execution attempts
    re.compile(r"(exec|eval|system|subprocess|os\.|import\s+os)", re.IGNORECASE),
    re.compile(r"(```|\"\"\").*(python|bash|shell|sh|cmd|powershell)", re.IGNORECASE),
]

# Suspicious pattern score weights
PATTERN_WEIGHTS: dict[str, float] = {
    "high": 1.0,   # Direct injection attempts
    "medium": 0.6, # Suspicious but could be legitimate
    "low": 0.3,    # Borderline patterns
}


def check_injection(instruction: str) -> Optional[str]:
    """
    Check an instruction for prompt injection attempts.
    
    Args:
        instruction: The user-supplied instruction text.
        
    Returns:
        An error message if injection detected, None if safe.
    """
    if not instruction or not instruction.strip():
        return "Instruction cannot be empty."
    
    # Check length
    if len(instruction) > 300:
        return f"Instruction too long ({len(instruction)}/300 characters)."
    
    # Check against injection patterns
    for pattern in INJECTION_PATTERNS:
        match = pattern.search(instruction)
        if match:
            matched_text = match.group(0)
            return f"Instruction contains potentially unsafe content near: '{matched_text[:60]}'. Please rephrase."
    
    # Check for unusual character distributions (e.g., excessive punctuation or special chars)
    special_ratio = sum(1 for c in instruction if not c.isalnum() and not c.isspace()) / max(len(instruction), 1)
    if special_ratio > 0.4 and len(instruction) > 10:
        return "Instruction contains an unusually high ratio of special characters. Please simplify."
    
    # Check for repeated tokens (possible adversarial attack)
    words = instruction.lower().split()
    if len(words) > 5:
        word_counts = Counter(words)
        most_common_count = word_counts.most_common(1)[0][1]
        if most_common_count / len(words) > 0.5:
            return "Instruction contains excessive repetition. Please write naturally."
    
    return None


def is_safe(instruction: str) -> bool:
    """Quick boolean check — returns True if instruction is safe."""
    return check_injection(instruction) is None


def sanitize(instruction: str, max_length: int = 300) -> str:
    """
    Sanitize an instruction by removing dangerous patterns.
    Returns the sanitized instruction (or truncated version).
    """
    safe = instruction[:max_length]
    
    for pattern in INJECTION_PATTERNS:
        safe = pattern.sub("[redacted]", safe)
    
    return safe.strip()
