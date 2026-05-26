from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.graph.state import PipelineStatus
from backend.app.schemas.node_output import (
    NodeOutput,
    clean_json_response,
    confidence_to_level,
    is_hallucinated,
)
from backend.app.services.hf_service import HFService
from backend.app.services.node_selector import NodeSelector
from backend.app.graph.council_graph import CouncilGraph

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

connected_clients: dict[str, list[WebSocket]] = {}

# JSON schema appended to case study expert prompts
CASE_STUDY_JSON_SCHEMA = """
Respond ONLY in the following JSON schema. No preamble, no markdown fences, no explanation outside the JSON:
{
    "confidence": <integer 0-100>,
    "position": "<string>",
    "reasoning": "<string>",
    "key_findings": ["<string>", ...],
    "concerns": ["<string>", ...],
    "revision": null
}
"""

CASE_STUDY_RETRY_PROMPT = (
    "\n\nYour previous response was not valid JSON matching the required schema. "
    "Retry now, responding ONLY with the JSON object. "
    "No preamble, no markdown fences, no explanation."
)


async def get_redis() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _parse_json_response(raw: str) -> dict[str, Any] | None:
    """Parse a raw LLM response as JSON and return validated fields.

    Uses the Pydantic NodeOutput model for validation, then converts
    to a dict for backward compatibility with the case study data format.
    """
    try:
        cleaned = clean_json_response(raw)
        data = json.loads(cleaned)
        # Validate with Pydantic model
        validated = NodeOutput(**data)
        # Convert to dict with string confidence level for backward compat
        return {
            "confidence": validated.confidence,
            "confidence_level": confidence_to_level(validated.confidence),
            "position": validated.position,
            "reasoning": validated.reasoning,
            "key_findings": validated.key_findings,
            "concerns": validated.concerns,
        }
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning("Failed to parse case study JSON response: %s", e)
        return None


# ---------------------------------------------------------------------------
# Redis-backed event history for WebSocket reconnection recovery
# ---------------------------------------------------------------------------

WS_EVENTS_KEY = "ws_events:{session_id}"
WS_PARTIAL_KEY = "partial:{session_id}:{node_name}"
WS_EVENTS_TTL = 600  # 10 minutes
WS_EVENTS_MAX = 100  # keep last 100 events


async def _store_event(
    redis: Redis, session_id: str, event: dict[str, Any]
) -> None:
    """Store a WebSocket event in Redis for later replay on reconnect."""
    key = WS_EVENTS_KEY.format(session_id=session_id)
    await redis.lpush(key, json.dumps(event))
    await redis.ltrim(key, 0, WS_EVENTS_MAX - 1)
    await redis.expire(key, WS_EVENTS_TTL)


async def _fetch_events_after(
    redis: Redis, session_id: str, last_event_id: int
) -> list[dict[str, Any]]:
    """Fetch events after a given event_id from the history."""
    key = WS_EVENTS_KEY.format(session_id=session_id)
    raw_events = await redis.lrange(key, 0, -1)
    events: list[dict[str, Any]] = []
    for raw in raw_events:
        try:
            evt = json.loads(raw)
            if evt.get("event_id", 0) > last_event_id:
                events.append(evt)
        except (json.JSONDecodeError, TypeError):
            continue
    # Reverse so they replay in original order (lpush = newest first)
    events.reverse()
    return events


async def _store_partial_result(
    redis: Redis, session_id: str, node_name: str, data: dict[str, Any]
) -> None:
    """Store a partial node result so it can be recovered on resume."""
    key = WS_PARTIAL_KEY.format(session_id=session_id, node_name=node_name)
    await redis.setex(key, WS_EVENTS_TTL, json.dumps(data))


async def _get_partial_results(
    redis: Redis, session_id: str, completed_node_names: set[str]
) -> dict[str, Any]:
    """Retrieve stored partial results for nodes that aren't yet complete."""
    results: dict[str, Any] = {}
    pattern = WS_PARTIAL_KEY.format(session_id=session_id, node_name="*")
    cursor = 0
    while True:
        cursor, keys = await redis.scan(
            cursor=cursor, match=pattern, count=50
        )
        for key in keys:
            parts = key.split(":")
            node_name = parts[-1]
            if node_name in completed_node_names:
                continue
            raw = await redis.get(key)
            if raw:
                try:
                    results[node_name] = json.loads(raw)
                except json.JSONDecodeError:
                    pass
        if cursor == 0:
            break
    return results


class EventSender:
    """Wrapper around WebSocket.send_json that auto-increments event_id
    and persists events to Redis for reconnection recovery."""

    def __init__(
        self, websocket: WebSocket, redis: Redis | None, session_id: str
    ) -> None:
        self.websocket = websocket
        self.redis = redis
        self.session_id = session_id
        self._counter: list[int] = [0]

    @property
    def last_event_id(self) -> int:
        return self._counter[0]

    async def send(self, event: dict[str, Any]) -> None:
        self._counter[0] += 1
        event["event_id"] = self._counter[0]
        # Store in Redis BEFORE sending so events survive a mid-send disconnect
        if self.redis is not None:
            await _store_event(self.redis, self.session_id, event)
        await self.websocket.send_json(event)

    async def send_reconnect_banner(self) -> None:
        """Notify frontend that events are being replayed after resume."""
        await self.websocket.send_json({
            "type": "resume_start",
            "last_event_id": self._counter[0],
        })


async def _handle_resume(
    sender: EventSender,
    redis: Redis,
    original_session_id: str,
    last_event_id: int,
) -> None:
    """Replay missed events from a previous session after reconnect.

    Also retrieves partial node results so the frontend can pick up
    where it left off.
    """
    await sender.send_reconnect_banner()

    events = await _fetch_events_after(redis, original_session_id, last_event_id)
    for event in events:
        # Re-assign event_id under the new session's counter
        sender._counter[0] += 1
        event["event_id"] = sender._counter[0]
        await sender.websocket.send_json(event)

    # Check for partial results
    completed_nodes: set[str] = set()
    for evt in events:
        domain = evt.get("domain") or evt.get("node", "")
        if evt.get("type") in ("expert_complete", "case_expert_complete", "node_complete"):
            completed_nodes.add(domain)
    partials = await _get_partial_results(redis, original_session_id, completed_nodes)
    if partials:
        await sender.websocket.send_json({
            "type": "partial_results",
            "data": partials,
        })

    await sender.websocket.send_json({
        "type": "resume_complete",
        "replayed": len(events),
        "partials": len(partials),
    })

    logger.info(
        "Resumed session %s: replayed %d events, recovered %d partials",
        original_session_id, len(events), len(partials),
    )


async def _generate_with_retry(
    hf_service: HFService,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
) -> tuple[dict[str, Any] | None, str]:
    """Generate an LLM response and parse as JSON, with one retry on failure."""
    response, model = await hf_service.generate(system_prompt, user_prompt, max_tokens=max_tokens)

    parsed = _parse_json_response(response)
    if parsed is not None:
        return parsed, model

    # Retry once with explicit instruction
    logger.warning("JSON parse failed on first attempt, retrying...")
    retry_system = system_prompt + CASE_STUDY_RETRY_PROMPT
    response2, model2 = await hf_service.generate(retry_system, user_prompt, max_tokens=max_tokens)
    parsed2 = _parse_json_response(response2)
    if parsed2 is not None:
        return parsed2, model2

    logger.error("JSON parse failed after retry")
    return None, model


async def _handle_case_study(
    sender: EventSender,
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

    await sender.send(
        {"type": "case_node_start", "node": "experts", "status": "expert_processing"}
    )

    # Run all expert nodes in parallel
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
            f"{CASE_STUDY_JSON_SCHEMA}\n"
        )
        expert_tasks[name] = _generate_with_retry(
            hf_service,
            system_prompt,
            user_prompt,
            max_tokens=settings.HF_EXPERT_MAX_TOKENS,
        )

    raw_results = await asyncio.gather(*expert_tasks.values(), return_exceptions=True)
    experts: dict[str, dict[str, Any]] = {}

    for node, result in zip(nodes, raw_results):
        name = node["name"]
        if isinstance(result, Exception):
            await sender.send(
                {"type": "expert_error", "domain": name, "error": str(result)}
            )
        else:
            parsed_data, model_used = result
            if parsed_data is None:
                await sender.send(
                    {
                        "type": "expert_error",
                        "domain": name,
                        "error": "Failed to produce valid structured output",
                    }
                )
                continue

            expert_entry = {
                "confidence": parsed_data["confidence_level"],
                "position": parsed_data.get("position", ""),
                "keyFindings": parsed_data.get("key_findings", []),
                "concerns": parsed_data.get("concerns", []),
                "reasoning": parsed_data.get("reasoning", ""),
                "model_used": model_used,
            }
            experts[name] = expert_entry
            # Store partial result
            if sender.redis is not None:
                await _store_partial_result(sender.redis, sender.session_id, name, expert_entry)
            await sender.send(
                {
                    "type": "case_expert_complete",
                    "domain": name,
                    "data": expert_entry,
                }
            )

    await sender.send({"type": "case_cross_check", "status": "cross_checking"})

    # Compute consensus from stored expert confidence levels
    confidence_map = {"low": 0.2, "medium": 0.5, "high": 0.8}
    consensus_scores = [
        confidence_map.get(e.get("confidence", "medium"), 0.5)
        for e in experts.values()
    ]
    consensus = round(sum(consensus_scores) / len(consensus_scores), 2) if consensus_scores else 0.5

    # Build expert summaries for cross-check prompt
    expert_summaries = "\n\n".join(
        [
            f"=== {name} (Confidence: {data.get('confidence', 'medium')}) ===\n"
            f"Position: {data.get('position', '')}\n"
            f"Key Findings: {', '.join(data.get('keyFindings', []))}\n"
            f"Concerns: {', '.join(data.get('concerns', []))}"
            for name, data in experts.items()
        ]
    )

    # Cross-check
    try:
        cross_response, _ = await hf_service.generate(
            "You are an impartial cross-check analyst. Compare the expert analyses below and identify areas of agreement, disagreement, and contradictions. "
            "Respond with a JSON object: {\"analysis\": \"<string>\", \"consensus_score\": <0.0-1.0>}",
            f"Expert Analyses:\n\n{expert_summaries}\n\nProvide a cross-check analysis.",
            max_tokens=1024,
        )
        cross_parsed = _parse_json_response(cross_response)
        cross_check_data = {
            "analysis": cross_parsed.get("analysis", cross_response) if cross_parsed else cross_response,
            "consensus_score": cross_parsed.get("consensus_score", consensus) if cross_parsed else consensus,
        }
    except Exception as e:
        logger.warning("Cross-check generation failed: %s", e)
        cross_check_data = {
            "analysis": "Cross-check could not be generated.",
            "consensus_score": consensus,
        }

    await sender.send({"type": "case_cross_check", "data": cross_check_data})

    # Synthesis
    await sender.send({"type": "case_synthesize", "status": "synthesizing"})

    try:
        synth_response, _ = await hf_service.generate(
            "You are a neutral synthesizer. Combine all expert analyses into a coherent final assessment. "
            "Respond with a JSON object: {\"verdict\": \"<string>\", \"reasoning\": \"<string>\", \"confidence\": \"<high|medium|low>\", \"consensus_score\": <0.0-1.0>, \"critical_findings\": [\"<string>\"], \"recommendations\": [\"<string>\"], \"unresolved_disagreements\": [\"<string>\"]}",
            f"Guiding Question: {guiding_question or 'N/A'}\n\nExpert Analyses:\n{expert_summaries}\n\nCross-check:\n{cross_check_data.get('analysis', '')}\n\nProvide a synthesis.",
            max_tokens=settings.HF_SYNTHESIS_MAX_TOKENS,
        )
        synth_parsed = _parse_json_response(synth_response)
        if synth_parsed:
            synthesis_data = {
                "verdict": synth_parsed.get("verdict", synth_response),
                "reasoning": synth_parsed.get("reasoning", ""),
                "confidence": synth_parsed.get("confidence", "medium"),
                "consensus_score": synth_parsed.get("consensus_score", consensus),
                "criticalFindings": synth_parsed.get("critical_findings", []),
                "recommendations": synth_parsed.get("recommendations", []),
                "unresolvedDisagreements": synth_parsed.get("unresolved_disagreements", []),
            }
        else:
            synthesis_data = {"verdict": synth_response}
    except Exception as e:
        logger.warning("Synthesis generation failed: %s", e)
        synthesis_data = {"verdict": "Synthesis could not be generated."}

    await sender.send({"type": "case_synthesize", "data": synthesis_data})

    await sender.send(
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
    sender: EventSender,
    situation: str,
    session_id: str,
    user_id: int,
    council_graph: CouncilGraph,
) -> None:
    async def on_node_start(node_name: str, status_text: str) -> None:
        await sender.send(
            {
                "type": "node_start",
                "node": node_name,
                "status": status_text,
            }
        )

    selector = NodeSelector(council_graph.hf_service)

    await sender.send({"type": "node_selection_start"})
    selected_nodes = await selector.select_nodes(situation)
    await sender.send(
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
            await sender.send(
                {
                    "type": "expert_error",
                    "domain": domain,
                    "error": str(result),
                }
            )
        else:
            output = result
            experts[domain] = output
            # Store partial result
            if sender.redis is not None:
                await _store_partial_result(sender.redis, sender.session_id, domain, output)
            # Send structured data that frontend can use
            await sender.send(
                {
                    "type": "expert_complete",
                    "domain": domain,
                    "data": {
                        "analysis": output.get("analysis", ""),
                        "confidence": output.get("confidence", "medium"),
                        "position": output.get("position", ""),
                        "reasoning": output.get("reasoning", ""),
                        "key_findings": output.get("key_findings", []),
                        "concerns": output.get("concerns", []),
                        "confidence_score": output.get("confidence_score"),
                        "model_used": output.get("model_used", ""),
                    },
                }
            )

    await on_node_start("cross_check", "cross_checking")
    cross_check_output = await cross_check_node.cross_check(experts)
    await sender.send(
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
    await sender.send(
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

    await sender.send(
        {
            "type": "complete",
            "data": {
                "status": "completed",
                "experts": [
                    {
                        "domain": d,
                        "analysis": e.get("analysis", ""),
                        "confidence": e.get("confidence", "medium"),
                        "position": e.get("position"),
                        "reasoning": e.get("reasoning"),
                        "key_findings": e.get("key_findings"),
                        "concerns": e.get("concerns"),
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

    # Connect to Redis for event history
    redis: Redis | None = None
    try:
        redis = await get_redis()
    except Exception as e:
        logger.warning("Redis unavailable, reconnection recovery disabled: %s", e)

    sender = EventSender(websocket, redis, session_id)

    try:
        data = await websocket.receive_json()

        # --- Handle resume message (reconnection recovery) ---
        if data.get("type") == "resume":
            original_session_id = data.get("session_id", session_id)
            last_event_id = data.get("last_event_id", 0)
            if redis is not None:
                await _handle_resume(sender, redis, original_session_id, last_event_id)
            else:
                await sender.send({"type": "error", "message": "Redis unavailable, cannot replay events"})
            return

        # --- Clear old event history for a fresh analysis ---
        if redis is not None:
            try:
                key = WS_EVENTS_KEY.format(session_id=session_id)
                await redis.delete(key)
            except Exception:
                pass

        # --- Handle case study mode ---
        mode = data.get("mode", "")
        if mode == "case_study":
            nodes = data.get("nodes", [])
            guiding_question = data.get("guidingQuestion", "")
            case_context = data.get("caseContext", "")
            await _handle_case_study(sender, nodes, guiding_question, case_context)
            return

        # --- Handle standard analysis mode ---
        situation = data.get("situation", "")
        user_id = data.get("user_id", 0)

        if not situation:
            await sender.send({"type": "error", "message": "situation is required"})
            return

        hf_service = HFService()
        council_graph = CouncilGraph(hf_service)

        await _stream_graph_events(
            sender, situation, session_id, user_id, council_graph
        )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: session %s", session_id)
    except Exception as e:
        logger.error("WebSocket error: %s", e)
        try:
            await sender.send({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if redis is not None:
            try:
                await redis.aclose()
            except Exception:
                pass
        if session_id in connected_clients:
            connected_clients[session_id].remove(websocket)
            if not connected_clients[session_id]:
                del connected_clients[session_id]
