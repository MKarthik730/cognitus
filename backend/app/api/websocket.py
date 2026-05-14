from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.graph.state import PipelineStatus
from backend.app.services.hf_service import HFService
from backend.app.services.node_selector import NodeSelector
from backend.app.graph.council_graph import CouncilGraph

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

connected_clients: dict[str, list[WebSocket]] = {}


async def get_redis() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _parse_case_response(text: str) -> dict[str, str]:
    result = {
        "confidence": "medium",
        "reasoning": "",
        "keyFindings": "",
        "concerns": "",
        "position": "",
    }
    lines = text.split("\n")
    current_key: str | None = None
    current_value: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("CONFIDENCE:"):
            if current_key:
                result[current_key] = "\n".join(current_value).strip()
            val = stripped[len("CONFIDENCE:") :].strip().lower()
            if val in ("low", "medium", "high"):
                result["confidence"] = val
            current_key = None
            current_value = []
        elif stripped.startswith("REASONING:"):
            if current_key:
                result[current_key] = "\n".join(current_value).strip()
            current_key = "reasoning"
            rest = stripped[len("REASONING:") :].strip()
            current_value = [rest] if rest else []
        elif stripped.startswith("KEY FINDINGS:"):
            if current_key:
                result[current_key] = "\n".join(current_value).strip()
            current_key = "keyFindings"
            rest = stripped[len("KEY FINDINGS:") :].strip()
            current_value = [rest] if rest else []
        elif stripped.startswith("CONCERNS:"):
            if current_key:
                result[current_key] = "\n".join(current_value).strip()
            current_key = "concerns"
            rest = stripped[len("CONCERNS:") :].strip()
            current_value = [rest] if rest else []
        elif stripped.startswith("POSITION:"):
            if current_key:
                result[current_key] = "\n".join(current_value).strip()
            current_key = "position"
            rest = stripped[len("POSITION:") :].strip()
            current_value = [rest] if rest else []
        elif current_key:
            current_value.append(line)

    if current_key:
        result[current_key] = "\n".join(current_value).strip()
    return result


async def _handle_case_study(
    websocket: WebSocket,
    nodes: list[dict[str, str]],
    guiding_question: str,
    case_context: str,
) -> None:
    hf_service = HFService()

    context = case_context
    if len(context) > 6000:
        try:
            context = await hf_service.summarize_text(
                context, filename="case_documents"
            )
        except Exception as e:
            logger.warning("Summarization failed, using raw context: %s", e)
    if len(context) > 10000:
        try:
            context = await hf_service.summarize_text(context, filename="combined")
        except Exception as e:
            logger.warning("Global compression failed, using previous context: %s", e)

    user_prompt = (
        f"Guiding question: {guiding_question}\nAnalyze this case thoroughly from your perspective."
        if guiding_question
        else "Analyze this case thoroughly from your perspective."
    )

    await websocket.send_json(
        {"type": "case_node_start", "node": "experts", "status": "expert_processing"}
    )

    expert_tasks: dict[str, Any] = {}
    for node in nodes:
        name = node["name"]
        behavior = node["behavior"]
        system_prompt = (
            f"{behavior}\n\n"
            f"---\n"
            f"CASE CONTEXT:\n{context}\n"
            f"---\n\n"
            f"IMPORTANT RULES:\n"
            f"1. Base your analysis ONLY on the provided case context.\n"
            f"2. Do not invent facts not present in the context.\n"
            f"3. If information is insufficient, state that clearly.\n"
            f"4. Be specific and reference details from the case.\n\n"
            f"Return in EXACTLY this format:\n"
            f"CONFIDENCE: [low|medium|high]\n"
            f"REASONING: [...]\n"
            f"KEY FINDINGS: [...]\n"
            f"CONCERNS: [...]\n"
            f"POSITION: [...]\n"
        )
        expert_tasks[name] = hf_service.generate(
            system_prompt, user_prompt, max_tokens=settings.HF_EXPERT_MAX_TOKENS
        )

    raw_results = await asyncio.gather(*expert_tasks.values(), return_exceptions=True)
    experts: dict[str, dict[str, str]] = {}

    for node, result in zip(nodes, raw_results):
        name = node["name"]
        if isinstance(result, Exception):
            await websocket.send_json(
                {"type": "expert_error", "domain": name, "error": str(result)}
            )
        else:
            response_text, model_used = result
            parsed = _parse_case_response(response_text)
            parsed["model_used"] = model_used
            experts[name] = parsed
            await websocket.send_json(
                {
                    "type": "case_expert_complete",
                    "domain": name,
                    "data": parsed,
                }
            )

    await websocket.send_json({"type": "case_cross_check", "status": "cross_checking"})

    confidence_map = {"low": 0.2, "medium": 0.5, "high": 0.8}
    scores = [
        confidence_map.get(e.get("confidence", "medium"), 0.5) for e in experts.values()
    ]
    consensus = round(sum(scores) / len(scores), 2) if scores else 0.5

    expert_summaries = "\n\n".join(
        [
            f"=== {name} (Confidence: {data.get('confidence', 'medium')}) ===\n"
            f"Position: {data.get('position', '')}\n"
            f"Key Findings: {data.get('keyFindings', '')}\n"
            f"Concerns: {data.get('concerns', '')}"
            for name, data in experts.items()
        ]
    )
    try:
        cross_response, _ = await hf_service.generate(
            "You are an impartial cross-check analyst. Compare the expert analyses below and identify areas of agreement, disagreement, and contradictions.",
            f"Expert Analyses:\n\n{expert_summaries}\n\nProvide a cross-check analysis.",
            max_tokens=1024,
        )
        cross_check_data = {
            "analysis": cross_response,
            "consensus_score": consensus,
        }
    except Exception as e:
        logger.warning("Cross-check generation failed: %s", e)
        cross_check_data = {
            "analysis": "Cross-check could not be generated.",
            "consensus_score": consensus,
        }

    await websocket.send_json({"type": "case_cross_check", "data": cross_check_data})

    await websocket.send_json({"type": "case_synthesize", "status": "synthesizing"})

    try:
        synth_response, _ = await hf_service.generate(
            "You are a neutral synthesizer. Combine all expert analyses into a coherent final assessment.",
            f"Guiding Question: {guiding_question or 'N/A'}\n\nExpert Analyses:\n{expert_summaries}\n\nCross-check:\n{cross_check_data.get('analysis', '')}\n\nProvide a synthesis.",
            max_tokens=settings.HF_SYNTHESIS_MAX_TOKENS,
        )
        synthesis_data = {
            "verdict": synth_response,
        }
    except Exception as e:
        logger.warning("Synthesis generation failed: %s", e)
        synthesis_data = {"verdict": "Synthesis could not be generated."}

    await websocket.send_json({"type": "case_synthesize", "data": synthesis_data})

    await websocket.send_json(
        {
            "type": "case_complete",
            "data": {
                "experts": experts,
                "crossCheck": cross_check_data,
                "synthesis": synthesis_data,
            },
        }
    )


async def _stream_graph_events(
    websocket: WebSocket,
    situation: str,
    session_id: str,
    user_id: int,
    council_graph: CouncilGraph,
) -> None:
    async def on_node_start(node_name: str, status_text: str) -> None:
        await websocket.send_json(
            {
                "type": "node_start",
                "node": node_name,
                "status": status_text,
            }
        )

    selector = NodeSelector(council_graph.hf_service)

    await websocket.send_json({"type": "node_selection_start"})
    selected_nodes = await selector.select_nodes(situation)
    await websocket.send_json(
        {
            "type": "node_selection_complete",
            "nodes": selected_nodes,
        }
    )

    cross_check_node = council_graph.cross_checker
    synthesizer_node = council_graph.synthesizer

    expert_behaviors: dict[str, str] = {
        n["name"]: n["behavior"] for n in selected_nodes
    }
    domains = [n["name"] for n in selected_nodes]

    await on_node_start("experts", "expert_processing")
    from backend.app.agents.expert_node import ExpertNode

    expert_tasks = {}
    for domain in domains:
        behavior = expert_behaviors.get(domain)
        node = ExpertNode(domain, council_graph.hf_service, behavior=behavior)
        expert_tasks[domain] = node.analyze(situation)

    raw_results = await asyncio.gather(*expert_tasks.values(), return_exceptions=True)
    experts: dict[str, Any] = {}
    for domain, result in zip(domains, raw_results):
        if isinstance(result, Exception):
            await websocket.send_json(
                {
                    "type": "expert_error",
                    "domain": domain,
                    "error": str(result),
                }
            )
        else:
            output = result
            experts[domain] = output
            await websocket.send_json(
                {
                    "type": "expert_complete",
                    "domain": domain,
                    "data": {
                        "analysis": output["analysis"],
                        "confidence": output["confidence"],
                        "model_used": output["model_used"],
                    },
                }
            )

    await on_node_start("cross_check", "cross_checking")
    cross_check_output = await cross_check_node.cross_check(experts)
    await websocket.send_json(
        {
            "type": "node_complete",
            "node": "cross_check",
            "data": {
                "contradictions": cross_check_output["contradictions"],
                "agreements": cross_check_output["agreements"],
                "consensus_score": cross_check_output["consensus_score"],
            },
        }
    )

    await on_node_start("synthesizer", "synthesizing")
    synthesis_output = await synthesizer_node.synthesize(
        situation, experts, cross_check_output
    )
    await websocket.send_json(
        {
            "type": "node_complete",
            "node": "synthesizer",
            "data": {
                "verdict": synthesis_output["verdict"],
                "reasoning": synthesis_output["reasoning"],
                "confidence": synthesis_output["confidence"],
                "consensus_score": synthesis_output["consensus_score"],
            },
            "status": "completed",
        }
    )

    await websocket.send_json(
        {
            "type": "complete",
            "data": {
                "status": "completed",
                "experts": [
                    {
                        "domain": d,
                        "analysis": e["analysis"],
                        "confidence": e["confidence"],
                    }
                    for d, e in experts.items()
                ],
                "contradictions": cross_check_output["contradictions"],
                "agreements": cross_check_output["agreements"],
                "consensus_score": cross_check_output["consensus_score"],
                "verdict": synthesis_output["verdict"],
                "synthesis_reasoning": synthesis_output["reasoning"],
                "synthesis_confidence": synthesis_output["confidence"],
            },
        }
    )


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
) -> None:
    await websocket.accept()
    logger.info("WebSocket connected: session %s", session_id)

    if session_id not in connected_clients:
        connected_clients[session_id] = []
    connected_clients[session_id].append(websocket)

    try:
        data = await websocket.receive_json()
        mode = data.get("mode", "")

        if mode == "case_study":
            nodes = data.get("nodes", [])
            guiding_question = data.get("guidingQuestion", "")
            case_context = data.get("caseContext", "")
            await _handle_case_study(websocket, nodes, guiding_question, case_context)
            return

        situation = data.get("situation", "")
        user_id = data.get("user_id", 0)

        if not situation:
            await websocket.send_json(
                {"type": "error", "message": "situation is required"}
            )
            return

        hf_service = HFService()
        council_graph = CouncilGraph(hf_service)

        await _stream_graph_events(
            websocket, situation, session_id, user_id, council_graph
        )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: session %s", session_id)
    except Exception as e:
        logger.error("WebSocket error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if session_id in connected_clients:
            connected_clients[session_id].remove(websocket)
            if not connected_clients[session_id]:
                del connected_clients[session_id]
