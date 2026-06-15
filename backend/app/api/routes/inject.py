import json
import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.session import Session
from app.schemas.inject import InjectNodeRequest, InjectNodeResponse
from app.services.prompt_guard import check_injection

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.post("/inject-node/", response_model=InjectNodeResponse)
async def inject_custom_node(
    body: InjectNodeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InjectNodeResponse:
    """
    Inject a custom node into an existing analysis graph.

    Takes a custom node definition and injects it between the
    specified `connect_from` and `connect_to` nodes, updating
    the graph edges accordingly.
    """
    # Validate instruction (prompt injection guard)
    node = body.node
    injection_error = check_injection(node.instruction)
    if injection_error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Instruction rejected: {injection_error}",
        )

    # Build the custom node entry
    custom_node_id = node.id or f"custom_{int(time.time())}"

    custom_node = {
        "id": custom_node_id,
        "label": node.label,
        "instruction": node.instruction,
        "color": node.color,
        "role": node.role,
    }

    # Try to load the existing graph — from DB session if available, or build fresh
    graph = None
    try:
        session_id = int(body.session_id)
        result = await db.execute(
            select(Session).where(
                Session.id == session_id,
                Session.user_id == current_user.id,
            )
        )
        session = result.scalar_one_or_none()
        if session:
            graph = _load_session_graph(session)
    except (ValueError, Exception):
        session = None

    if graph:
        # Inject into existing graph
        graph = _inject_into_graph(
            graph=graph,
            custom_node=custom_node,
            connect_from=node.connect_from,
            connect_to=node.connect_to,
        )
    else:
        # Create a minimal graph with just this node
        graph = {
            "nodes": [custom_node],
            "edges": [],
            "mode": "standard",
        }

    # Persist to session if available
    if session:
        try:
            import json
            if hasattr(session, 'metadata') and session.metadata:
                meta = json.loads(session.metadata) if isinstance(session.metadata, str) else session.metadata
            else:
                meta = {}
            meta["graph"] = graph
            session.metadata = json.dumps(meta)
            await db.commit()
        except Exception:
            pass

    return InjectNodeResponse(graph=graph)


def _load_session_graph(session: Session) -> dict | None:
    """Load the graph JSON from a session's metadata."""
    try:
        import json
        meta = session.metadata
        if meta:
            if isinstance(meta, str):
                meta = json.loads(meta)
            return meta.get("graph")
    except Exception:
        pass
    return None


def _inject_into_graph(
    graph: dict,
    custom_node: dict,
    connect_from: str,
    connect_to: str,
) -> dict:
    """
    Inject a custom node between connect_from and connect_to.
    
    OLD: connect_from → connect_to
    NEW: connect_from → custom_node → connect_to
    """
    nodes = list(graph.get("nodes", []))
    edges = list(graph.get("edges", []))

    # Add the custom node
    nodes.append(custom_node)

    # Update edges
    new_edges = []
    has_original_edge = False

    for edge in edges:
        if edge.get("from") == connect_from and edge.get("to") == connect_to:
            # Replace with two edges: from → custom, custom → to
            new_edges.append({"from": connect_from, "to": custom_node["id"]})
            new_edges.append({"from": custom_node["id"], "to": connect_to})
            has_original_edge = True
        else:
            new_edges.append(edge)

    # If the original edge didn't exist, just append both edges
    if not has_original_edge:
        new_edges.append({"from": connect_from, "to": custom_node["id"]})
        new_edges.append({"from": custom_node["id"], "to": connect_to})

    graph["nodes"] = nodes
    graph["edges"] = new_edges
    return graph
