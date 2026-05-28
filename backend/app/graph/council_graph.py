from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from langgraph.graph import END, StateGraph

from app.agents.cross_check import CrossCheckNode
from app.agents.distributor import DistributorNode
from app.agents.expert_node import ExpertNode
from app.agents.synthesizer import SynthesizerNode
from app.agents.assumption_excavator import AssumptionExcavator
from app.agents.signal_noise import SignalNoiseAnalyzer
from app.agents.cascade_mapper import CascadeMapper
from app.agents.pre_mortem import PreMortemAnalyzer
from app.agents.debate import DebateAnalyzer
from app.agents.reverse_engineer import ReverseEngineer
from app.agents.iceberg import IcebergAnalyzer
from app.agents.stress_tester import StressTester
from app.graph.state import CouncilState, DomainName, AnalysisMode
from app.services.hf_service import HFService
from app.services.llm_router import get_llm_router


class CouncilGraph:
    def __init__(self, hf_service: HFService) -> None:
        self.hf_service = hf_service
        self.distributor = DistributorNode(hf_service)
        self.cross_checker = CrossCheckNode(hf_service)
        self.synthesizer = SynthesizerNode(hf_service)
        self.assumption_excavator = AssumptionExcavator()
        self.signal_noise = SignalNoiseAnalyzer()
        self.cascade_mapper = CascadeMapper()
        self.pre_mortem = PreMortemAnalyzer()
        self.debate = DebateAnalyzer()
        self.reverse_engineer = ReverseEngineer()
        self.iceberg = IcebergAnalyzer()
        self.stress_tester = StressTester()
        self._graph = self._build_graph()
        self._thinking_steps: list[dict[str, Any]] = []

    def _build_graph(self) -> StateGraph:
        workflow = StateGraph(CouncilState)

        workflow.add_node("run_assumption_excavator", self._run_assumption_excavator)
        workflow.add_node("run_distributor", self._run_distributor)
        workflow.add_node("run_experts", self._run_experts)
        workflow.add_node("run_cross_check", self._run_cross_check)
        workflow.add_node("run_synthesizer", self._run_synthesizer)

        workflow.set_entry_point("run_assumption_excavator")
        workflow.add_edge("run_assumption_excavator", "run_distributor")
        workflow.add_edge("run_distributor", "run_experts")
        workflow.add_edge("run_experts", "run_cross_check")
        workflow.add_edge("run_cross_check", "run_synthesizer")
        workflow.add_edge("run_synthesizer", END)

        return workflow.compile()

    async def _run_assumption_excavator(self, state: CouncilState) -> dict[str, Any]:
        """Run assumption excavator before the main pipeline."""
        try:
            assumptions = await self.assumption_excavator.excavate_with_fallback(state["situation"])
            return {"assumptions": assumptions}
        except Exception as e:
            return {"assumptions": []}

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

        # Add Minority Report
        try:
            output["minority_report"] = await self._generate_minority_report(
                state["situation"], state["experts"], state["cross_check"]
            )
        except Exception:
            output["minority_report"] = ""

        # Add What Would Change My Mind
        try:
            output["what_would_change_my_mind"] = await self._generate_wwcmm(
                state["situation"], output
            )
        except Exception:
            output["what_would_change_my_mind"] = []

        # Add Confidence Breakdown
        output["confidence_breakdown"] = self._compute_confidence_breakdown(
            state["experts"], state["cross_check"]
        )

        # Add Situation DNA
        try:
            output["situation_dna"] = await self._generate_situation_dna(
                state["situation"]
            )
        except Exception:
            output["situation_dna"] = {}

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

    async def _generate_minority_report(
        self, situation: str, experts: dict[str, Any], cross_check: Any
    ) -> str:
        """Surface the single strongest dissenting expert opinion."""
        router = get_llm_router()
        expert_summaries = "\n".join(
            f"{domain}: {e.get('position', e.get('analysis', ''))[:300]}"
            for domain, e in experts.items()
        )
        prompt = (
            "Given these expert analyses, identify the single strongest dissenting opinion "
            "— the one expert who disagreed with the majority. Explain why their minority "
            "view might still be right, even though the council ruled against it.\n\n"
            f"{expert_summaries}"
        )
        response, _ = await router.generate(
            "You surface dissenting opinions that might still be valid.",
            prompt, max_tokens=512
        )
        return response.strip()

    async def _generate_wwcmm(self, situation: str, synthesis: dict) -> list[str]:
        """Generate 'What Would Change My Mind' conditions."""
        router = get_llm_router()
        prompt = (
            f"Verdict: {synthesis.get('verdict', '')}\n"
            f"Confidence: {synthesis.get('confidence', 'medium')}\n\n"
            "What specific assumptions, information, or events would change this verdict? "
            "List 3-5 specific conditions.\n"
            "Respond ONLY with a JSON array of strings."
        )
        try:
            response, _ = await router.generate(
                "You identify falsifiable conditions for verdicts.",
                prompt, max_tokens=512
            )
            from app.schemas.node_output import clean_json_response
            import json
            cleaned = clean_json_response(response)
            data = json.loads(cleaned)
            if isinstance(data, list):
                return data[:5]
            return []
        except Exception:
            return []

    async def _generate_situation_dna(self, situation: str) -> dict[str, str]:
        """Auto-generate situation DNA profile."""
        router = get_llm_router()
        prompt = (
            f"Analyze this situation and classify it on these dimensions:\n"
            f"- Complexity: Low/Medium/High\n"
            f"- Reversibility: Low/Medium/High\n"
            f"- Time pressure: Low/Medium/High\n"
            f"- Stakeholders: Single/Multiple/Conflicting\n"
            f"- Information: Complete/Partial/Incomplete\n"
            f"- Emotion load: Low/Medium/High\n\n"
            f"Situation: {situation[:500]}\n\n"
            "Respond ONLY with JSON: {\"complexity\": \"...\", \"reversibility\": \"...\", ...}"
        )
        try:
            response, _ = await router.generate(
                "You profile situations on multiple dimensions.",
                prompt, max_tokens=256
            )
            from app.schemas.node_output import clean_json_response
            import json
            cleaned = clean_json_response(response)
            return json.loads(cleaned)
        except Exception:
            return {}

    def _compute_confidence_breakdown(
        self, experts: dict[str, Any], cross_check: Any
    ) -> dict[str, float]:
        """Compute multi-dimensional confidence breakdown."""
        # Information quality: based on expert count + consensus
        info_quality = min(1.0, len(experts) / 5.0 * 0.5 + 0.3)

        # Expert agreement: from cross_check consensus
        expert_agreement = float(cross_check.get("consensus_score", 0.5))

        # Assumption risk: inversely related to consensus
        assumption_risk = max(0.0, 1.0 - expert_agreement)

        # Precedent match: placeholder (would require DB lookup)
        precedent_match = 0.5

        # Overall: weighted average
        overall = (
            info_quality * 0.25 +
            expert_agreement * 0.35 +
            (1.0 - assumption_risk) * 0.2 +
            precedent_match * 0.2
        )

        return {
            "information_quality": round(info_quality, 2),
            "expert_agreement": round(expert_agreement, 2),
            "assumption_risk": round(assumption_risk, 2),
            "precedent_match": round(precedent_match, 2),
            "overall": round(overall, 2),
        }

    # ------------------------------------------------------------------
    # New analysis modes
    # ------------------------------------------------------------------

    async def run_signal_noise(self, situation: str) -> dict[str, Any]:
        return await self.signal_noise.analyze(situation)

    async def run_cascade_map(self, situation: str) -> dict[str, Any]:
        return await self.cascade_mapper.analyze(situation)

    async def run_pre_mortem(self, situation: str) -> dict[str, Any]:
        return await self.pre_mortem.analyze(situation)

    async def run_debate(self, situation: str) -> dict[str, Any]:
        return await self.debate.analyze(situation)

    async def run_reverse_engineer(self, situation: str) -> dict[str, Any]:
        return await self.reverse_engineer.analyze(situation)

    async def run_iceberg(self, situation: str) -> dict[str, Any]:
        return await self.iceberg.analyze(situation)

    async def run_stress_test(self, situation: str, verdict: str, reasoning: str) -> dict[str, Any]:
        return await self.stress_tester.analyze(situation, verdict, reasoning)

    # ------------------------------------------------------------------
    # R1 Thinking step capture
    # ------------------------------------------------------------------

    def capture_thinking_step(self, node_name: str, step: str, content: str) -> None:
        """Capture a DeepSeek R1 thinking step for canvas rendering."""
        self._thinking_steps.append({
            "node": node_name,
            "step": step,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def get_thinking_steps(self, clear: bool = True) -> list[dict[str, Any]]:
        """Get and optionally clear captured thinking steps."""
        steps = list(self._thinking_steps)
        if clear:
            self._thinking_steps.clear()
        return steps

    # ------------------------------------------------------------------
    # Main run method
    # ------------------------------------------------------------------

    async def run(
        self,
        situation: str,
        session_id: str,
        user_id: int,
        analysis_mode: AnalysisMode = "standard",
    ) -> CouncilState:
        # Dict dispatch for special analysis modes — avoids code duplication
        mode_fns = {
            "signal_vs_noise": self.run_signal_noise,
            "cascade_mapper": self.run_cascade_map,
            "pre_mortem": self.run_pre_mortem,
            "debate": self.run_debate,
            "reverse_engineer": self.run_reverse_engineer,
            "iceberg": self.run_iceberg,
        }

        if analysis_mode in mode_fns:
            output = await mode_fns[analysis_mode](situation)

            # Run hallucination detection on the output
            from app.schemas.node_output import is_hallucinated, NodeOutput
            try:
                # Wrap output in NodeOutput-like structure for check
                hallucinated = is_hallucinated(NodeOutput(
                    confidence=50,
                    position=str(output.get(list(output.keys())[0], ''))[:100],
                    reasoning=str(output)[:500],
                    key_findings=[str(k) for k in (list(output.keys()) if output else [])],
                    concerns=[],
                ))
                if hallucinated:
                    output["_hallucination_warning"] = True
            except Exception:
                pass

            return {
                "situation": situation,
                "metadata": {
                    "session_id": session_id,
                    "user_id": user_id,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "analysis_mode": analysis_mode,
                },
                "analysis_mode": analysis_mode,
                "mode_output": output,
                "status": "completed",
            }

        # Default: run the full standard pipeline
        initial_state: CouncilState = {
            "situation": situation,
            "metadata": {
                "session_id": session_id,
                "user_id": user_id,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "analysis_mode": analysis_mode,
            },
            "status": "pending",
            "analysis_mode": analysis_mode,
        }
        return await self._graph.ainvoke(initial_state)
