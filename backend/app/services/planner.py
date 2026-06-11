"""
Planner LLM — dynamically generates agent node graphs based on
the user's query and selected analysis mode.

The Planner runs as a fast LLM call before any agents execute.
It outputs a JSON graph structure (nodes + edges) that defines
which agents run and how they connect.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Planner system prompt
# ---------------------------------------------------------------------------

PLANNER_SYSTEM_PROMPT = """You are a strategic planner for a multi-agent AI deliberation system called "Council".
Your job is to dynamically design a node graph of AI agents based on the user's query and analysis mode.

Each node is an AI agent with a specific perspective. Each edge defines the flow of information between agents.

## Rules
1. Identify the domain: political, technical, personal, research, debate, business, creative, etc.
2. Pick 4-7 relevant agent perspectives for that domain
3. Write a SPECIFIC instruction per agent (not generic — tailored to the query)
4. Define edge flow showing which agent feeds into which
5. All agents must connect in a DAG (directed acyclic graph) — no cycles
6. Return only valid JSON, no extra text, no markdown formatting

## Available roles
- analyst: Neutral analysis and fact-finding
- critic: Finds flaws, weaknesses, and counterarguments
- devil: Strongest possible opposing position
- synthesizer: Combines all perspectives into a cohesive verdict
- domain_expert: Deep expertise in a specific field
- emotional: Considers human/emotional factors
- technical: Technical feasibility and implementation details
- historian: Historical context and precedent
- verdict: Makes final call / judgment
- moderator: Oversees debate and ensures fairness

## Available colors
indigo, amber, cyan, green, red, purple

## Output format (strict JSON)
{
  "nodes": [
    {"id": "unique_snake_case_id", "label": "Human Readable Name", "instruction": "Specific instruction for THIS query", "color": "indigo", "role": "analyst"},
    ...
  ],
  "edges": [
    {"from": "node_id", "to": "node_id"},
    ...
  ],
  "mode": "the_mode_used"
}

## Mode-specific defaults (you can adapt these per query):

### pre_mortem
Agents: Devil's Advocate → Risk Analyzer → Opportunity Scanner → Logic Filter → Synthesizer
Shape: linear chain with risk branching

### signal_vs_noise  
Agents: Fact Checker → Relevance Filter → Gap Finder → Synthesizer
Shape: funnel narrowing to output

### debate
Agents: Pro Agent → Con Agent → Evidence Checker → Neutral Moderator → Verdict Gate
Shape: two opposing chains merging at verdict

### iceberg
Agents: Surface Analyst → Hidden Assumptions → Root Cause → Second Order Effects → Synthesizer
Shape: vertical deep-dive chain

### reverse_engineer
Agents: Outcome Analyzer → Cause Tracer → Pattern Finder → Solution Architect → Verdict
Shape: backwards chain from outcome to cause

### cascade
Agents: Event Analyzer → First Order Effects → Second Order → Third Order → Synthesizer
Shape: branching tree expanding outward

### standard
Agents: Domain decomposition specialists feeding into a synthesizer
Shape: star/parallel — multiple experts to one synthesizer
"""


async def generate_plan(
    query: str,
    mode: str = "standard",
    custom_nodes: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """
    Generate a node graph plan for the given query and mode.

    Args:
        query: The user's question or situation description.
        mode: Analysis mode (standard, debate, research, etc.).
        custom_nodes: Optional list of pre-defined custom nodes to include.

    Returns:
        Dict with "nodes", "edges", and "mode" keys.
    """
    router = get_llm_router()
    
    user_prompt = _build_user_prompt(query, mode, custom_nodes)
    
    try:
        response, model = await router.generate(
            system=PLANNER_SYSTEM_PROMPT,
            user=user_prompt,
            max_tokens=2048,
        )
        
        plan = _parse_plan_response(response)
        
        # Validate and fix plan
        plan = _validate_plan(plan, query, mode)
        
        # Inject custom nodes if provided
        if custom_nodes:
            plan = _inject_custom_nodes(plan, custom_nodes)
        
        logger.info(
            "Planner generated graph: %d nodes, %d edges (mode=%s, model=%s)",
            len(plan.get("nodes", [])),
            len(plan.get("edges", [])),
            mode,
            model,
        )
        
        return plan
    
    except Exception as e:
        logger.error("Planner failed: %s", e)
        return _fallback_plan(query, mode)


def _build_user_prompt(
    query: str,
    mode: str,
    custom_nodes: Optional[list[dict[str, Any]]] = None,
) -> str:
    """Build the user prompt for the planner LLM."""
    prompt_parts = [
        f"Query: {query}",
        f"Mode: {mode}",
    ]
    
    if custom_nodes:
        prompt_parts.append(
            f"Custom nodes to include:\n{json.dumps(custom_nodes, indent=2)}"
        )
    
    prompt_parts.append(
        "\nDesign a node graph with 4-7 agents. Return ONLY valid JSON."
    )
    
    return "\n\n".join(prompt_parts)


def _parse_plan_response(response: str) -> dict[str, Any]:
    """Parse the LLM response into a plan dict, handling JSON extraction."""
    # Try to extract JSON from the response
    json_match = re.search(r"\{[\s\S]*\}", response)
    if json_match:
        json_str = json_match.group(0)
    else:
        json_str = response
    
    # Clean up common LLM artifacts
    json_str = json_str.strip()
    if json_str.startswith("```json"):
        json_str = json_str[7:]
    if json_str.startswith("```"):
        json_str = json_str[3:]
    if json_str.endswith("```"):
        json_str = json_str[:-3]
    
    try:
        plan = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse planner JSON: %s", e)
        raise
    
    return plan


def _validate_plan(
    plan: dict[str, Any],
    query: str,
    mode: str,
) -> dict[str, Any]:
    """Validate and fix a generated plan."""
    nodes = plan.get("nodes", [])
    edges = plan.get("edges", [])
    
    # Ensure we have nodes
    if not nodes:
        raise ValueError("Planner returned empty node list")
    
    # Ensure each node has required fields
    for node in nodes:
        node.setdefault("color", _default_color(node.get("role", "analyst")))
        node.setdefault("role", "analyst")
        node.setdefault("label", node.get("id", "Agent"))
        node.setdefault("instruction", f"Analyze this query from your perspective: {query[:200]}")
        
        # Ensure id is unique
        node["id"] = re.sub(r"[^a-z0-9_]", "_", node["id"].lower().strip())
        if not node["id"]:
            node["id"] = f"agent_{len(nodes)}"
    
    # Ensure we have edges
    if not edges and len(nodes) > 1:
        # Build a default chain: first node → ... → last node
        edges = []
        for i in range(len(nodes) - 1):
            edges.append({"from": nodes[i]["id"], "to": nodes[i + 1]["id"]})
    
    # Validate edges point to existing nodes
    node_ids = {n["id"] for n in nodes}
    valid_edges = []
    for edge in edges:
        from_id = edge.get("from", "")
        to_id = edge.get("to", "")
        if from_id in node_ids and to_id in node_ids:
            valid_edges.append({"from": from_id, "to": to_id})
    edges = valid_edges
    
    # Build a chain if still no valid edges
    if not edges and len(nodes) > 1:
        for i in range(len(nodes) - 1):
            edges.append({"from": nodes[i]["id"], "to": nodes[i + 1]["id"]})
    
    plan["nodes"] = nodes
    plan["edges"] = edges
    plan["mode"] = mode
    
    return plan


def _default_color(role: str) -> str:
    """Map a role to a default color."""
    color_map = {
        "analyst": "indigo",
        "critic": "amber",
        "devil": "red",
        "synthesizer": "purple",
        "domain_expert": "cyan",
        "emotional": "green",
        "technical": "cyan",
        "historian": "amber",
        "verdict": "purple",
        "moderator": "indigo",
    }
    return color_map.get(role, "indigo")


def _inject_custom_nodes(
    plan: dict[str, Any],
    custom_nodes: list[dict[str, Any]],
) -> dict[str, Any]:
    """Inject custom nodes into the plan graph."""
    nodes = plan.get("nodes", [])
    edges = plan.get("edges", [])
    
    for custom in custom_nodes:
        # Ensure unique id
        node_id = custom.get("id", f"custom_{len(nodes) + 1}")
        
        node_entry = {
            "id": node_id,
            "label": custom.get("label", "Custom Agent"),
            "instruction": custom.get("instruction", ""),
            "color": custom.get("color", "indigo"),
            "role": custom.get("role", "domain_expert"),
        }
        nodes.append(node_entry)
        
        # Inject edges: connect_from → custom → connect_to
        connect_from = custom.get("connect_from")
        connect_to = custom.get("connect_to")
        
        # Remove the original edge between connect_from and connect_to (if exists)
        edges = [
            e for e in edges
            if not (e["from"] == connect_from and e["to"] == connect_to)
        ]
        
        # Add new edges
        edges.append({"from": connect_from, "to": node_id})
        edges.append({"from": node_id, "to": connect_to})
    
    plan["nodes"] = nodes
    plan["edges"] = edges
    return plan


def _fallback_plan(query: str, mode: str) -> dict[str, Any]:
    """Generate a simple fallback plan when the planner LLM fails."""
    fallback_nodes = [
        {
            "id": "analyst",
            "label": "Analyst",
            "instruction": f"Analyze the query objectively: {query[:200]}",
            "color": "indigo",
            "role": "analyst",
        },
        {
            "id": "critic",
            "label": "Critic",
            "instruction": f"Find weaknesses and counterarguments: {query[:200]}",
            "color": "amber",
            "role": "critic",
        },
        {
            "id": "synthesizer",
            "label": "Synthesizer",
            "instruction": f"Synthesize all perspectives into a verdict: {query[:200]}",
            "color": "purple",
            "role": "synthesizer",
        },
    ]
    
    return {
        "nodes": fallback_nodes,
        "edges": [
            {"from": "analyst", "to": "critic"},
            {"from": "critic", "to": "synthesizer"},
        ],
        "mode": mode,
    }
