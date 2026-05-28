from __future__ import annotations

from typing import TypedDict, Literal, NotRequired


DomainName = str

ConfidenceLevel = Literal["high", "medium", "low"]

ContradictionType = Literal["direct", "partial", "complementary"]

PipelineStatus = Literal[
    "pending", "distributing", "expert_processing",
    "cross_checking", "synthesizing", "completed", "failed",
]

AnalysisMode = Literal[
    "standard", "case_study", "signal_vs_noise", "cascade_mapper",
    "pre_mortem", "debate", "reverse_engineer", "iceberg",
]

GhostLevel = Literal["off", "fog", "shadow", "void", "phantom"]


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
    # Intelligence Layer additions
    minority_report: NotRequired[str]
    what_would_change_my_mind: NotRequired[list[str]]
    confidence_breakdown: NotRequired[dict[str, float]]


class Assumption(TypedDict):
    assumption: str
    category: str  # factual | cultural | emotional | logical | temporal | relational
    importance: str  # critical | moderate | minor
    why_hidden: str
    user_decision: NotRequired[str]  # confirmed | denied | modified
    user_modification: NotRequired[str]


class GhostModeState(TypedDict):
    level: GhostLevel
    disclosure: dict[str, str]
    llm_override: NotRequired[str | None]


class ChatMessage(TypedDict):
    question: str
    response: str
    node: str
    timestamp: str


class GraphMetadata(TypedDict):
    session_id: str
    user_id: int
    started_at: str
    completed_at: NotRequired[str]
    total_processing_time_ms: NotRequired[int]
    models_used: NotRequired[list[str]]
    analysis_mode: NotRequired[AnalysisMode]
    ghost_level: NotRequired[GhostLevel]


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
    # Ghost Mode
    ghost_mode: NotRequired[GhostModeState]
    # Assumption Excavator
    assumptions: NotRequired[list[Assumption]]
    # Analysis mode overrides
    analysis_mode: NotRequired[AnalysisMode]
    mode_output: NotRequired[dict]  # Output from special modes
    # Chat history
    chat_history: NotRequired[list[ChatMessage]]
    # R1 thinking steps
    thinking_steps: NotRequired[list[dict]]
    # Situation DNA
    situation_dna: NotRequired[dict]
    # Confidence breakdown
    confidence_breakdown: NotRequired[dict[str, float]]
