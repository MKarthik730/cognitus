from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.graph.state import PipelineStatus
from backend.app.services.hf_service import HFService
from backend.app.graph.council_graph import CouncilGraph

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

connected_clients: dict[str, list[WebSocket]] = {}


async def get_redis() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)


async def _stream_graph_events(
    websocket: WebSocket,
    situation: str,
    session_id: str,
    user_id: int,
    council_graph: CouncilGraph,
) -> None:
    async def on_node_start(node_name: str, state: dict[str, Any]) -> None:
        await websocket.send_json(
            {
                "type": "node_start",
                "node": node_name,
                "status": state.get("status", "unknown"),
            }
        )

    distributor_node = council_graph.distributor
    cross_check_node = council_graph.cross_checker
    synthesizer_node = council_graph.synthesizer

    await on_node_start("distributor", {"status": "distributing"})
    distributor_output = await distributor_node.dispatch(situation)
    await websocket.send_json(
        {
            "type": "node_complete",
            "node": "distributor",
            "data": {
                "domains": distributor_output["domains"],
                "reasoning": distributor_output["reasoning"],
                "model_used": distributor_output["model_used"],
            },
            "status": "expert_processing",
        }
    )

    await on_node_start("experts", {"status": "expert_processing"})
    import asyncio
    from backend.app.agents.expert_node import ExpertNode

    domains = distributor_output["domains"]
    expert_tasks = {}
    for domain in domains:
        node = ExpertNode(domain, council_graph.hf_service)
        expert_tasks[domain] = node.analyze(situation)

    results = await asyncio.gather(*expert_tasks.values(), return_exceptions=True)
    experts: dict[str, Any] = {}
    for domain, result in zip(domains, results):
        if isinstance(result, Exception):
            await websocket.send_json(
                {
                    "type": "expert_error",
                    "domain": domain,
                    "error": str(result),
                }
            )
        else:
            experts[domain] = result
            await websocket.send_json(
                {
                    "type": "expert_complete",
                    "domain": domain,
                    "data": {
                        "analysis": result["analysis"],
                        "confidence": result["confidence"],
                        "model_used": result["model_used"],
                    },
                }
            )

    await on_node_start("cross_check", {"status": "cross_checking"})
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

    await on_node_start("synthesizer", {"status": "synthesizing"})
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
