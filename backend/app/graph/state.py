from __future__ import annotations

from typing import TypedDict, Literal, NotRequired


DomainName = str

ConfidenceLevel = Literal["high", "medium", "low"]

ContradictionType = Literal["direct", "partial", "complementary"]

PipelineStatus = Literal[
    "pending",
    "distributing",
    "expert_processing",
    "cross_checking",
    "synthesizing",
    "completed",
    "failed",
]


class SelectedNode(TypedDict):
    name: str
    role: str
    behavior: str


class DistributorOutput(TypedDict):
    domains: list[DomainName]
    reasoning: str
    model_used: str


class ExpertOutput(TypedDict):
    domain: str
    analysis: str
    confidence: ConfidenceLevel
    position: NotRequired[str]
    reasoning: NotRequired[str]
    key_findings: NotRequired[list[str]]
    concerns: NotRequired[list[str]]
    confidence_score: NotRequired[int]
    citations: NotRequired[list[str]]
    model_used: str
    processing_time_ms: int
    revision: NotRequired[str | None]


class Contradiction(TypedDict):
    between: tuple[str, str]
    type: ContradictionType
    description: str
    severity: ConfidenceLevel


class Agreement(TypedDict):
    between: tuple[str, str]
    points: list[str]


class CrossCheckOutput(TypedDict):
    contradictions: list[Contradiction]
    agreements: list[Agreement]
    consensus_score: float
    model_used: str


class SynthesisOutput(TypedDict):
    verdict: str
    reasoning: str
    confidence: ConfidenceLevel
    consensus_score: float
    model_used: str
    processing_time_ms: int


class GraphMetadata(TypedDict):
    session_id: str
    user_id: int
    started_at: str
    completed_at: NotRequired[str]
    total_processing_time_ms: NotRequired[int]
    models_used: NotRequired[list[str]]


class CouncilState(TypedDict):
    situation: str
    metadata: GraphMetadata
    selected_nodes: NotRequired[list[SelectedNode]]
    distributor: NotRequired[DistributorOutput]
    experts: NotRequired[dict[str, ExpertOutput]]
    cross_check: NotRequired[CrossCheckOutput]
    synthesis: NotRequired[SynthesisOutput]
    errors: NotRequired[list[str]]
    status: PipelineStatus
