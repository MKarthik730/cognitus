# Cognitus

> Multi-perspective AI reasoning platform — parallel expert agents, structured JSON analysis, and real-time streaming canvas.

Cognitus operates in two modes:

- **Standard Mode** — Ask a question; the system dynamically selects 3–5 domain expert agents, decomposes the question into sub-problems, runs parallel analysis, cross-checks for contradictions, and synthesises a forced-commitment verdict.
- **Case Study Mode** — Upload real files (PDF, DOCX, images, CSV), define custom expert nodes with tailored system prompts, and run a fully grounded multi-agent analysis on the uploaded content.

Everything streams to an animated canvas graph over WebSocket in real time.



## Architecture

![Cognitus Architecture](./docs/architecture.svg)

## Pipeline

![Cognitus Pipeline](./docs/pipeline.svg)



---

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM Provider | Pluggable: HuggingFace · Groq · Anthropic · OpenRouter · Ollama |
| Backend | FastAPI + Uvicorn + WebSockets |
| Frontend | Vanilla JS + Canvas API + Vite |
| Document Extraction | PDF.js (browser) · mammoth.js (browser) · PyMuPDF (server) · python-docx (server) |
| Database | PostgreSQL 16 + pgvector (async via asyncpg) |
| ORM | SQLAlchemy 2.0 async |
| Cache | Redis 7 |
| Auth | JWT + bcrypt |
| Embeddings | sentence-transformers all-MiniLM-L6-v2 (local) |
| Container | Docker + Docker Compose |

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose
- At least one LLM provider API key (see [LLM Providers](#llm-providers))

---

## Quick Start

```bash
# Clone
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus

# Environment
cp .env.example .env
# Edit .env — set at minimum: LLM_PROVIDER + the matching API key

# Start everything
docker compose up --build
```

Frontend: http://localhost:5173  
Backend API: http://localhost:8000  
API docs: http://localhost:8000/docs

---

## Manual Development Setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
pip install PyMuPDF python-docx  # file extraction
pip install sentence-transformers # RAG (requires PyTorch ~800MB)

# Frontend
cd frontend && npm install && cd ..

# Infrastructure
docker compose up -d postgres redis

# Backend (port 8000)
uvicorn backend.main:app --reload --port 8000

# Frontend (port 5173)
cd frontend && npm run dev
```

> The backend starts without Redis/Postgres — it logs a warning and runs in standalone mode for WebSocket testing.

---

## LLM Providers

Set `LLM_PROVIDER` in `.env` to one of:

| Value | Model default | Required env var |
|---|---|---|
| `huggingface` | Llama-3.2-1B-Instruct | `HF_API_TOKEN` |
| `groq` | llama3-8b-8192 | `GROQ_API_KEY` |
| `anthropic` | claude-3-haiku-20240307 | `ANTHROPIC_API_KEY` |
| `openrouter` | any (passthrough) | `OPENROUTER_API_KEY` |
| `ollama` | configurable | `OLLAMA_BASE_URL` |

The provider/model can also be switched at runtime from the Settings panel in the frontend (stored in `localStorage`).

**HuggingFace fallback chain:** `Llama-3.2-1B-Instruct` → `DeepSeek-R1-Distill-Qwen-1.5B` → `Arch-Router-1.5B`

---

## Features

### Standard Mode

The Distributor breaks the question into 3–5 domain-specific sub-questions. The Node Selector (LLM call) picks expert roles on the fly — roles appear in the left panel with a staggered fade-in. Each expert receives their sub-question plus full context and responds as structured JSON (`NodeOutput` schema). On parse failure, falls back to 3 generic nodes: Analyst, Critic, Synthesist.

### Case Study Mode

Switch to the **Case Study** tab to access the file drop zone.

**Supported file types:**

| Type | Extraction |
|---|---|
| PDF | PDF.js (browser) + PyMuPDF (server) |
| DOCX | mammoth.js (browser) + python-docx (server) |
| PNG / JPG / WEBP | Base64 → LLM image description |
| MD / TXT / CSV | FileReader API as plain text |

Multiple files allowed. Per-file extraction status (spinner → ready / failed). Failed files show a retry button and are excluded from analysis.

**Context pipeline:**

1. Assemble — concatenate all ready file contents
2. Estimate — if total > 6000 chars, run per-file summarisation
3. Compress — if still > 10 000 chars, run global compression pass
4. RAG slice — chunk, embed (all-MiniLM-L6-v2), store in pgvector; each expert node retrieves its top-5 relevant chunks via cosine similarity before LLM call
5. Inject — each node receives a `CASE_CONTEXT` string

A banner appears when context was condensed: *"Case files condensed to fit analysis limits."*

**Node Builder:**

Define 2–6 custom expert nodes with name, role, behavior (system prompt), and color. Supports collapse/expand, duplicate, reorder (drag handle), and delete (disabled at 2 nodes).

**Preset templates:**

| Template | Nodes |
|---|---|
| Medical Team | Cardiologist, Intensivist, Pharmacologist, Risk Assessor |
| Detective Squad | Evidence Analyst, Forensic Pathologist, Psychologist, Legal Advisor |
| Startup Review | Investor, CFO, Market Analyst, Devil's Advocate |
| Legal Panel | Prosecution, Defense Counsel, Forensic Expert, Judge |
| Engineering Review | Backend Engineer, Security Analyst, DevOps Lead, QA Engineer |
| Custom | 2 empty node slots |

### JSON Parsing + Hallucination Detection

All node responses are parsed as structured JSON against the `NodeOutput` Pydantic schema:

```python
class NodeOutput(BaseModel):
    confidence: int          # 0–100
    position: str
    reasoning: str
    key_findings: list[str]
    concerns: list[str]
    revision: str | None
```

Pipeline: strip markdown fences → `json.loads()` → `NodeOutput(**parsed)` → hallucination check → on failure, re-prompt once → on second failure, mark node as `error` and exclude from synthesis.

The `is_hallucinated()` check flags placeholder patterns and enforces a minimum reasoning length.

### Token Streaming

When enabled (Settings panel toggle, stored in `localStorage`):

- Backend yields tokens from the LLM as they arrive, sending `node_token` WebSocket events every 50ms
- Canvas shows a pulsing border glow and live character count inside each node circle while streaming
- On `node_complete`, the full structured JSON is parsed and rendered

### Cross-Examination

After the first parallel expert round, a cross-examination pass runs before synthesis:

- Each node receives the other nodes' positions and key findings
- Each node responds: `maintains_position` (bool), `revision` (str|null), `points_of_agreement`, `points_of_disagreement`
- Validated with `CrossExamineOutput` Pydantic model
- "Position maintained" / "Position revised" badges shown per node
- Canvas edge colors: green = agreement · red = disagreement · yellow = partial

### Result Caching

Before each LLM call, a SHA256 key is computed from `(file_contents, node_behavior, question)`. On a cache hit, the stored result is deserialised and a `node_cached` WebSocket event is sent — no LLM call made. Cache TTL: 3600s (Redis).

- "⚡ Cached" badge shown on cached node cards
- Settings panel: "Clear cache" button → `DELETE /api/cache/{session_id}`

### Data Enrichment

When `ENRICHMENT_ENABLED=true`, the pipeline runs before node execution:

1. Entity extraction — LLM extracts `{ people, organizations, drugs, locations, dates, legal_refs }`
2. Web enrichment — Tavily search on top entities (requires `TAVILY_API_KEY`)
3. Domain API enrichment:
   - `medical` → PubMed E-utilities
   - `legal` → CourtListener
   - `startup` → SEC EDGAR
   - `engineering` → NVD CVE API
4. Enriched context (raw + web_data + domain_data) injected into all nodes

UI shows enrichment status steps: "Extracting entities… Fetching web context… Querying domain sources…"

### Interactive Canvas

- **Node click** — hit-test by distance, scrolls to the matching node card in the Outputs tab with a ring animation
- **Confidence arc** — thin arc around each node circle, fill % = confidence score, gradient red → yellow → green
- **Bezier edges** — colored by agreement (green/red/yellow), thickness proportional to confidence delta; hover tooltip shows `"NodeA ↔ NodeB: {agreement_summary}"`
- **Zoom & pan** — mouse wheel zoom (0.5×–3×), click-drag on empty space to pan, double-click to reset fit
- **Minimap** — bottom-right corner (100×75px), full graph at reduced scale with viewport rectangle overlay

### Follow-Up Conversation

After analysis completes, a chat input appears below the verdict panel. Each follow-up message is sent to `POST /api/analyze/followup` with the full conversation history and prior analysis as context. Responses stream via SSE. Cited nodes are shown as highlighted chips.

### Export

Export button in the verdict panel header opens a dropdown:

| Option | Endpoint | Output |
|---|---|---|
| Export as PDF | `POST /api/export/pdf` | Multi-page PDF (verdict, per-node sections, synthesis) |
| Export as JSON | `GET /api/export/json/{session_id}` | Full analysis state |
| Copy link | signed JWT | Read-only `/view/{session_id}?token=...` |

### WebSocket Resilience

Auto-reconnect with exponential backoff: 1s → 2s → 4s → 8s → 16s (max 5 attempts).

On reconnect, the frontend sends `{ type: 'resume', session_id, last_event_id }`. The backend replays missed events from Redis (last 100 events per session, 10-min TTL) and recovers partial node results. After 5 failures: "Connection lost — Click Retry."

---

## Output

**Verdict tab:** Verdict card · confidence pill · consensus meter (0–100% gradient) · critical findings · unresolved disagreements · numbered recommendations · full reasoning block

**Node Outputs tab:** One card per node with colored left border · position · key findings · concerns · reasoning (collapsible) · cross-examination section · cross-check card at bottom

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/sessions` | List user sessions |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/{id}` | Get session |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/analyze` | Run council analysis |
| GET | `/api/analyze/{id}` | Get completed analysis |
| POST | `/api/analyze/followup` | Follow-up conversation turn |
| WS | `/ws/{session_id}` | Real-time streaming graph events |
| POST | `/api/case-study/upload` | Upload file for case study |
| DELETE | `/api/cache/{session_id}` | Clear result cache for session |
| POST | `/api/export/pdf` | Export analysis as PDF |
| GET | `/api/export/json/{session_id}` | Export analysis as JSON |
| GET | `/view/{session_id}` | Read-only shared viewer |
| POST | `/api/evals/run` | Run eval suite (admin only) |
| GET | `/api/nodes` | List available expert domains |
| GET | `/health` | Health check |

---

## Eval Harness

```bash
# Run all fixtures
python -m backend.evals.runner --all

# Run single fixture
python -m backend.evals.runner --fixture medical
```

5 fixtures (medical, detective, startup, legal, engineering). Each fixture defines `min_consensus`, `required_findings`, `forbidden_content`, `min_node_confidence`, `synthesis_must_contain`. The runner scores each check and prints a formatted pass/fail table.

Admin API: `POST /api/evals/run` — requires `ADMIN_SECRET` env var.

---

## Rate Limits (HuggingFace free tier)

| Limit | Value |
|---|---|
| Global | 800 requests/day |
| Per user | 50 requests/hour |
| Burst | 1 request/2 seconds |
| Retry | tenacity exponential backoff: 2s → 4s → 8s |
| Cache TTL | 24h (SHA256 key, Redis) |

HF calls per analysis: 6–8 (1 distributor + 3–5 experts + 1 cross-examine + 1 synthesiser)

---

## Project Structure

```
cognitus/
├── backend/
│   ├── app/
│   │   ├── agents/
│   │   │   ├── distributor.py
│   │   │   ├── expert_node.py       # JSON parsing, hallucination check, streaming, caching, RAG
│   │   │   ├── cross_check.py
│   │   │   └── synthesizer.py
│   │   ├── graph/
│   │   │   ├── state.py
│   │   │   └── council_graph.py     # cross_examine node wired in
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── auth.py
│   │   │   │   ├── sessions.py
│   │   │   │   ├── analyze.py       # followup + evals/run endpoints
│   │   │   │   ├── cache.py         # DELETE /api/cache/{session_id}
│   │   │   │   ├── config_route.py  # PATCH /api/config
│   │   │   │   ├── eval.py
│   │   │   │   └── export.py        # PDF + JSON + share link
│   │   │   ├── upload.py
│   │   │   └── websocket.py         # event_id, Redis history, resume, node_token events
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── database.py          # pgvector extension enabled
│   │   │   └── security.py
│   │   ├── services/
│   │   │   ├── llm_provider.py      # LLMProvider ABC + 5 implementations
│   │   │   ├── hf_service.py
│   │   │   ├── node_selector.py
│   │   │   ├── rate_limiter.py
│   │   │   ├── cache.py
│   │   │   ├── cache_key.py         # SHA256 key generation
│   │   │   ├── embedder.py          # sentence-transformers + pgvector
│   │   │   ├── enrichment.py        # entity extraction + Tavily + domain APIs
│   │   │   └── queue_worker.py
│   │   ├── models/
│   │   │   ├── chunks.py            # DocumentChunk ORM (Vector(384))
│   │   │   └── ...                  # 7 tables total
│   │   └── schemas/
│   │       └── node_output.py       # NodeOutput + CrossExamineOutput Pydantic models
│   ├── evals/
│   │   ├── __init__.py
│   │   ├── fixtures.json            # 5 case study fixtures
│   │   └── runner.py                # EvalResult, CLI, scoring
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app.js                   # follow-up chat, export dropdown, node click handler
│   │   ├── store.js                 # followup_history, cross-examination events
│   │   ├── canvas.js                # confidence arcs, bezier edges, zoom/pan, minimap
│   │   ├── api.js                   # CognitusSocket class, exponential backoff, resume
│   │   ├── groq.js                  # Groq SSE streaming client
│   │   ├── utils.js
│   │   ├── main.js
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── postgres/
│   └── init.sql                     # includes document_chunks + pgvector extension
├── docker-compose.yml
└── .env.example
```

---

## Environment Variables

```env
# LLM
LLM_PROVIDER=groq                    # huggingface | groq | anthropic | openrouter | ollama
HF_API_TOKEN=
GROQ_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434

# App
SECRET_KEY=your-secret-key-here

# Infrastructure
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/cognitus
REDIS_URL=redis://redis:6379

# Features
ENRICHMENT_ENABLED=false
TAVILY_API_KEY=

# Admin
ADMIN_SECRET=
```

---

## License

MIT
