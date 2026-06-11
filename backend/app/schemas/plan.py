from pydantic import BaseModel, Field


class PlannerRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    mode: str = Field(default="standard", pattern=r"^(standard|debate|research|decision|technical|cascade|pre_mortem|signal_vs_noise|iceberg|reverse_engineer)$")


class PlanNode(BaseModel):
    id: str
    label: str
    instruction: str
    color: str  # indigo | amber | cyan | green | red | purple
    role: str   # analyst | critic | synthesizer | devil | historian | technical | emotional | verdict


class PlanEdge(BaseModel):
    from_: str = Field(..., alias="from")
    to: str


class PlanResponse(BaseModel):
    nodes: list[PlanNode]
    edges: list[PlanEdge]
    mode: str
