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
from backend.app.graph.state import CouncilState, DomainName
from backend.app.services.hf_service import HFService

EventCallback = callable[[str, dict[str, Any]], None] | None


class CouncilGraph:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service
        self.distributor = DistributorNode(hf_service)
        self.cross_checker = CrossCheckNode(hf_service)
        self.synthesizer = SynthesizerNode(hf_service)
        self._graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(CouncilState)

        workflow.add_node("distributor", self._run_distributor)
        workflow.add_node("experts", self._run_experts)
        workflow.add_node("cross_check", self._run_cross_check)
        workflow.add_node("synthesizer", self._run_synthesizer)

        workflow.set_entry_point("distributor")
        workflow.add_edge("distributor", "experts")
        workflow.add_edge("experts", "cross_check")
        workflow.add_edge("cross_check", "synthesizer")
        workflow.add_edge("synthesizer", END)

        return workflow.compile()

    async def _run_distributor(self, state: CouncilState) -> dict[str, Any]:
        output = await self.distributor.dispatch(state["situation"])
        return {"distributor": output, "status": "expert_processing"}

    async def _run_experts(self, state: CouncilState) -> dict[str, Any]:
        domains: list[DomainName] = state["distributor"]["domains"]
        experts: dict[str, Any] = {}
        errors: list[str] = []
        tasks = []

        for domain in domains:
            node = ExpertNode(domain, self.hf_service)
            tasks.append(node.analyze(state["situation"]))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for domain, result in zip(domains, results):
            if isinstance(result, Exception):
                errors.append(f"{domain}: {str(result)}")
            else:
                experts[domain] = result

        result: dict[str, Any] = {"experts": experts, "status": "cross_checking"}
        if errors:
            result["errors"] = state.get("errors", []) + errors
        return result

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
