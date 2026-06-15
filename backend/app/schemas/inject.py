from pydantic import BaseModel, Field


def to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    import re
    s1 = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


class CustomNodeSchema(BaseModel):
    model_config = {
        "alias_generator": to_snake,
        "populate_by_name": True,
    }

    id: str = Field(default="", pattern=r"^custom_\d+$")
    label: str = Field(..., min_length=1, max_length=100)
    instruction: str = Field(..., min_length=1, max_length=300)
    role: str = Field(default="analyst")
    color: str = Field(default="indigo")
    bias: float = Field(default=0.5, ge=0.0, le=1.0)
    confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    connect_from: str = Field(..., min_length=1)
    connect_to: str = Field(..., min_length=1)


class InjectNodeRequest(BaseModel):
    session_id: str
    node: CustomNodeSchema


class InjectNodeResponse(BaseModel):
    graph: dict  # Updated graph JSON with nodes + edges
