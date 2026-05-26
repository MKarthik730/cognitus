from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from langgraph.graph import END, StateGraph

from backend.app.agents.cross_check import CrossCheckNode
from backend.app.agents.distributor import DistributorNode
from backend.app.agents.expert_node import ExpertNode
from backend.app.agents.synthesizer import SynthesizerNode
from backend.app.graph.state import CouncilState
from backend.app.services.hf_service import HFService


class CouncilGraph:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service
        self.distributor = DistributorNode(hf_service)
        self.cross_checker = CrossCheckNode(hf_service)
        self.synthesizer = SynthesizerNode(hf_service)
        self._graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(CouncilState)

        workflow.add_node("run_distributor", self._run_distributor)
        workflow.add_node("run_experts", self._run_experts)
        workflow.add_node("run_cross_check", self._run_cross_check)
        workflow.add_node("run_synthesizer", self._run_synthesizer)

        workflow.set_entry_point("run_distributor")
        workflow.add_edge("run_distributor", "run_experts")
        workflow.add_edge("run_experts", "run_cross_check")
        workflow.add_edge("run_cross_check", "run_synthesizer")
        workflow.add_edge("run_synthesizer", END)

        return workflow.compile()

    async def _run_distributor(self, state: CouncilState) -> dict[str, Any]:
        output = await self.distributor.dispatch(state["situation"])
        return {"distributor": output, "status": "expert_processing"}

    async def _run_experts(self, state: CouncilState) -> dict[str, Any]:
        sub_questions = state["distributor"]["sub_questions"]
        # Key by sub-question id (unique) to avoid overwriting when two
        # sub-questions share the same domain
        coroutines: dict[str, Any] = {}
        coro_map: list[tuple[str, str, str]] = []  # (sq_id, domain, question)

        for sq in sub_questions:
            sq_id = sq["id"]
            domain = sq["domain"]
            question = sq["question"]
            node = ExpertNode(domain, self.hf_service)
            coroutines[sq_id] = node.analyze(
                state["situation"], sub_question=question, sub_question_id=sq_id
            )
            coro_map.append((sq_id, domain, question))

        results = await asyncio.gather(*coroutines.values(), return_exceptions=True)

        resolved: dict[str, Any] = {}
        errors: list[str] = []
        for (sq_id, domain, _question), result in zip(coro_map, results):
            if isinstance(result, Exception):
                errors.append(f"{domain} ({sq_id}): {str(result)}")
            else:
                resolved[sq_id] = result

        result_dict: dict[str, Any] = {"experts": resolved, "status": "cross_checking"}
        if errors:
            result_dict["errors"] = state.get("errors", []) + errors
        return result_dict

    async def _run_cross_check(self, state: CouncilState) -> dict[str, Any]:
        output = await self.cross_checker.cross_check(state["experts"])
        return {"cross_check": output, "status": "synthesizing"}

    async def _run_synthesizer(self, state: CouncilState) -> dict[str, Any]:
        start = time.monotonic()
        output = await self.synthesizer.synthesize(
            state["situation"],
            state["experts"],
            state["cross_check"],
        )
        output["processing_time_ms"] = int((time.monotonic() - start) * 1000)

        models: list[str] = []
        if "distributor" in state:
            models.append(state["distributor"]["model_used"])
        if "experts" in state:
            for exp in state["experts"].values():
                models.append(exp["model_used"])
        if "cross_check" in state:
            models.append(state["cross_check"]["model_used"])
        models.append(output["model_used"])

        metadata = dict(state["metadata"])
        metadata["completed_at"] = datetime.now(timezone.utc).isoformat()
        metadata["models_used"] = list(set(models))

        return {
            "synthesis": output,
            "metadata": metadata,
            "status": "completed",
        }

    async def run(
        self,
        situation: str,
        session_id: str,
        user_id: int,
    ) -> CouncilState:
        initial_state: CouncilState = {
            "situation": situation,
            "metadata": {
                "session_id": session_id,
                "user_id": user_id,
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
            "status": "pending",
        }
        return await self._graph.ainvoke(initial_state)
