from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    session_id: int


class ExpertResponseSchema(BaseModel):
    domain: str
    analysis_text: str
    confidence: str
    model_used: str
    processing_time_ms: int


class ContradictionSchema(BaseModel):
    domain_a: str
    domain_b: str
    type: str
    description: str
    severity: str


class AgreementSchema(BaseModel):
    domain_a: str
    domain_b: str
    points: list[str]


class AnalysisResponse(BaseModel):
    id: int
    session_id: int
    distributor_output: Optional[str]
    cross_check_output: Optional[str]
    synthesis_output: Optional[str]
    consensus_score: Optional[float]
    status: str
    completed_at: Optional[datetime]
    expert_responses: list[ExpertResponseSchema]
    contradictions: list[ContradictionSchema]
    agreements: list[AgreementSchema]
    created_at: datetime
    updated_at: datetime
