<div align="center">

# Cognitus

<img src="https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python&logoColor=white" />
<img src="https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi&logoColor=white" />
<img src="https://img.shields.io/badge/HuggingFace-Router-FFD21E?style=flat-square&logo=huggingface&logoColor=black" />
<img src="https://img.shields.io/badge/LangGraph-Pipeline-6366f1?style=flat-square" />
<img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" />
<img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white" />
<img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" />

### Multi-perspective AI reasoning — at the speed of thought.

Cognitus assembles a **council of expert AI agents** that analyze any situation from independent domain viewpoints simultaneously. They don't just summarize — they disagree, interrogate each other's assumptions, surface contradictions, and commit to a single actionable verdict. Every step of that reasoning streams live to an animated canvas graph so you can watch the council think.

Built for decisions that are too complex for one perspective and too important to get wrong.

</div>

---

## The Problem It Solves

Most AI tools give you one answer from one perspective. For simple questions, that's fine. But real decisions — *should we restructure this company, how do we handle this legal dispute, what's actually causing this patient's symptoms* — involve competing valid viewpoints, hidden tradeoffs, and assumptions that need to be challenged.

Cognitus approaches these problems the way a good advisory panel would: multiple independent experts analyze the same situation in parallel, then their findings are stress-tested against each other before a synthesis is reached. The result is not a summarized opinion — it is a reasoned verdict with an explicit confidence score, documented disagreements, and the chain of reasoning that produced it.

---

## Modes

| Mode | When to use it | How it works |
|---|---|---|
| **Standard** | Open-ended questions, strategic dilemmas, research topics | Type your question → Cognitus dynamically selects 3–5 domain experts best suited to the problem → parallel analysis → cross-examination → verdict |
| **Case Study** | Real documents, evidence-based decisions, structured investigations | Upload your files (PDF, DOCX, images, CSVs) → define custom expert nodes with tailored personas and behaviors → grounded multi-agent analysis on the actual content |

Both modes stream every pipeline step — node selection, expert responses, cross-check findings, synthesis — to an animated canvas graph in real time via WebSocket.

---

## Agent Pipeline

<img src="docs/pipeline.svg" width="100%" alt="Cognitus Agent Pipeline"/>

### How the pipeline works

**1. Distributor — Case Decomposer**

The Distributor does not just label domains. It reads the full situation and breaks it into 3–5 *specific, focused sub-questions* — one per expert — that are meaningfully different from each other and directly answerable from the case context. For a corporate insolvency case it might produce: *"Is the proposed bailout sufficient given the monthly burn rate?"*, *"What does the Air India privatization precedent tell us about realistic timelines?"*, and *"What leverage does the union actually hold ahead of the Q3 deadline?"* — rather than generic domain labels like `["finance", "legal"]`.

**2. Expert Nodes — Parallel Specialist Analysis**

Each expert receives their specific sub-question plus the full situation as context. Experts are instructed to cite concrete numbers, take a clear position, and not hedge. Responses are validated as structured JSON against a strict Pydantic schema — if a response fails validation or triggers hallucination detection, the node retries once before being marked as an error and excluded. All expert nodes run in parallel; the pipeline does not wait for the slowest node before proceeding.

**3. Cross-Check — Contradiction Analyst**

The Cross-Check node receives every expert output and compares them pairwise. It identifies direct contradictions (where two experts reach opposing conclusions from the same evidence), partial contradictions (where experts agree on facts but disagree on interpretation), and complementary findings (where different angles reinforce each other). It computes a consensus score between 0.0 and 1.0. A score near 0.5 signals genuine expert disagreement — not a failure, but a signal that the synthesis must surface the tension rather than paper over it.

**4. Synthesizer — Committed Verdict**

The Synthesizer is explicitly instructed to pick one primary recommendation and commit to it. It receives the full expert outputs plus the cross-check analysis, reconciles disagreements, and states the conditions under which its verdict would change. It does not produce a list of equally weighted options. If the evidence is genuinely split, it says so — with the specific points of irresolvable disagreement documented.

---

## System Architecture

<img src="docs/architecture.svg" width="100%" alt="Cognitus System Architecture"/>

### Architecture notes

The frontend is intentionally framework-free — Vanilla JS with a Canvas API graph renderer, a reactive state store built on a `subscribe(key, fn)` pattern, and client-side document extraction via PDF.js and mammoth.js. This keeps the bundle small, eliminates hydration complexity, and means the canvas graph can be updated at 60fps without React reconciliation overhead.

The backend is a FastAPI application running on Uvicorn with the full agent pipeline orchestrated by LangGraph's `StateGraph`. Each pipeline run is a directed acyclic graph of async nodes; expert nodes are executed as a parallel `asyncio.gather()` fan-out. Results are persisted to PostgreSQL via async SQLAlchemy, with Redis serving as the response cache, rate limiter, WebSocket event log, and task queue simultaneously.

The HuggingFace Router client wraps all LLM calls with a three-model fallback chain and tenacity-based exponential backoff, so transient API failures are handled transparently without surfacing errors to the user.

---

## WebSocket Event Flow

<img src="docs/websocket.svg" width="100%" alt="Cognitus WebSocket Event Sequence"/>

### Connection behavior

The WebSocket connection is managed by a `CognitusSocket` class on the frontend that wraps the native WebSocket with automatic reconnection logic. On an unexpected close (any code other than 1000), it attempts reconnect with exponential backoff — 1s, 2s, 4s, 8s, 16s — up to five attempts. On reconnect, it sends a `resume` message with the session ID and the last received event ID; the backend replays any missed events from Redis (last 100 events per session, 10-minute TTL). After five failed attempts the UI surfaces a manual retry button.

Every outbound server message carries an incrementing `event_id`. Partial node results are stored in Redis under `partial:{session_id}:{node_name}` so a reconnecting client can recover mid-analysis without restarting the full pipeline.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **LLM Provider** | HuggingFace Inference Router | Free-tier access to frontier models with automatic fallback across Mistral-7B → Zephyr-7B → Phi-3 |
| **Backend** | Python 3.12, FastAPI, Uvicorn | Async-native, fast startup, excellent WebSocket support |
| **Pipeline** | LangGraph StateGraph | Explicit DAG orchestration with typed state — makes the pipeline structure auditable and testable |
| **Frontend** | Vanilla JS, Canvas API, Vite 5 | No framework overhead; full control over canvas rendering and animation |
| **Document Extraction** | PDF.js + mammoth.js (browser) · PyMuPDF + python-docx (server) | Client-side extraction avoids upload round-trips for text documents; server-side handles images |
| **Database** | PostgreSQL 16 via asyncpg + SQLAlchemy 2.0 | Async-native ORM, full analysis history, contradiction and agreement tables for audit trail |
| **Cache / Queue** | Redis 7 | Single service for response cache, rate limiter, WebSocket event log, and async task queue |
| **Auth** | JWT + bcrypt via python-jose + passlib | Stateless token auth with secure password hashing |
| **LLM Resilience** | tenacity | Declarative retry with exponential backoff and model fallback on TimeoutException and RequestError |
| **Containers** | Docker + Docker Compose | Single-command startup for all four services |

---

## Project Structure

```
cognitus/
├── backend/
│   ├── main.py                        # FastAPI app entry — lifespan, CORS, router mounts
│   ├── requirements.txt
│   └── app/
│       ├── agents/
│       │   ├── distributor.py         # Case decomposer: situation → focused sub-questions per expert
│       │   ├── expert_node.py         # JSON-mode expert with Pydantic validation + hallucination detection
│       │   ├── cross_check.py         # Pairwise contradiction + agreement analysis, consensus scoring
│       │   └── synthesizer.py         # Final verdict — forced single recommendation, no hedging
│       ├── api/
│       │   ├── routes/
│       │   │   ├── auth.py            # POST /api/auth/register  POST /api/auth/login
│       │   │   ├── sessions.py        # CRUD for analysis sessions (paginated list, get, delete)
│       │   │   └── analyze.py         # POST /api/analyze  GET /api/analyze/{id}
│       │   ├── upload.py              # POST /api/case-study/upload — server-side image extraction
│       │   └── websocket.py           # WS /ws/{session_id} — Standard + Case Study streaming
│       ├── core/
│       │   ├── config.py              # Pydantic Settings — HF, DB, Redis, JWT, rate limits
│       │   ├── database.py            # Async SQLAlchemy engine + session factory
│       │   └── security.py           # JWT creation/verification, bcrypt password hashing
│       ├── graph/
│       │   ├── state.py               # TypedDicts for all pipeline states
│       │   └── council_graph.py       # LangGraph StateGraph: distributor → experts → cross-check → synthesizer
│       ├── models/                    # SQLAlchemy ORM models (7 tables)
│       │   ├── user.py · session.py · analysis.py · expert_response.py
│       │   ├── contradiction.py · agreement.py · api_usage_log.py
│       │   └── base.py
│       ├── schemas/
│       │   ├── node_output.py         # NodeOutput · CrossExamineOutput · SynthesisResult · DistributorResult
│       │   ├── auth.py · sessions.py · analyze.py
│       └── services/
│           ├── hf_service.py          # HF Router client — retry, fallback chain, image analysis, summarization
│           ├── node_selector.py       # LLM-powered dynamic node selection for Standard Mode
│           ├── rate_limiter.py        # Redis token bucket: burst / hourly / daily tiers
│           ├── cache.py               # SHA256-keyed Redis response cache (24h TTL)
│           └── queue_worker.py        # Redis BLPOP task queue — graceful shutdown, pub/sub result delivery
│
└── frontend/
    └── src/
        ├── app.js                     # Main application logic, event handlers, file extraction pipeline
        ├── store.js                   # Reactive state store — subscribe(key, fn), WS event → state mapping
        ├── canvas.js                  # Canvas graph renderer: nodes, animated edges, minimap, zoom/pan
        ├── api.js                     # CognitusSocket WS client + exponential backoff + HTTP client
        ├── utils.js                   # Markdown renderer, domain colors, preset templates, file icons
        └── styles.css                 # Complete dark theme — no CSS framework
```

---

## Database Schema

Seven tables with full indexing and foreign key relationships:

```
users
  id · username · email · hashed_password · is_active · created_at · updated_at

sessions
  id · user_id → users · title · situation (text) · status · created_at · updated_at

analyses
  id · session_id → sessions · distributor_output (JSON) · cross_check_output (JSON)
     · synthesis_output (JSON) · consensus_score (float) · status · completed_at

expert_responses
  id · analysis_id → analyses · domain · analysis_text · confidence (int)
     · model_used · processing_time_ms · created_at

contradictions
  id · analysis_id → analyses · domain_a · domain_b · type · description · severity

agreements
  id · analysis_id → analyses · domain_a · domain_b · points (JSON)

api_usage_log
  id · user_id → users · endpoint · model_used · tokens_used · ip_address · created_at
```

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Register new user (username, email, password) |
| `POST` | `/api/auth/login` | — | Login and receive JWT access token |
| `GET` | `/api/sessions/` | JWT | List user's sessions with pagination |
| `POST` | `/api/sessions/` | JWT | Create a new analysis session |
| `GET` | `/api/sessions/{id}` | JWT | Get session details |
| `DELETE` | `/api/sessions/{id}` | JWT | Delete a session |
| `POST` | `/api/analyze/` | JWT | Run full council analysis (REST) |
| `GET` | `/api/analyze/{id}` | JWT | Retrieve completed analysis with all expert responses |
| `WS` | `/ws/{session_id}` | — | Real-time streaming — Standard and Case Study modes |
| `POST` | `/api/case-study/upload` | — | Server-side file extraction for images |
| `GET` | `/api/nodes` | — | List available expert domains |
| `GET` | `/health` | — | Health check |

---

## File Extraction

Cognitus extracts text from uploaded documents client-side wherever possible to avoid unnecessary upload latency. Only image files require a server round-trip for AI-powered analysis.

| File Type | Where | Library / Method |
|---|---|---|
| PDF (digital, selectable text) | Browser | PDF.js — iterates pages, extracts text layer content items |
| DOCX | Browser | mammoth.js — converts Word XML to clean plain text |
| PNG / JPG / WEBP | Server | HuggingFace API — base64-encoded image sent for visual analysis |
| TXT / MD / CSV | Browser | FileReader.readAsText() — direct string read |

Documents exceeding 6,000 characters are automatically summarized by the LLM before being passed to expert nodes, with a second global compression pass if combined context still exceeds 10,000 characters. A *"Case files condensed"* banner is shown in the UI when compression occurs.

> **Note on scanned PDFs:** PDF.js extracts text layers only. A scanned PDF (a photograph of a document) contains no text layer and will extract as empty. OCR support via Tesseract is not yet implemented — digital PDFs work fully.

---

## Hallucination Detection

Every expert node response passes through `is_hallucinated()` before being accepted. The function checks for patterns indicating the model produced filler content rather than a real analysis. On detection, the node retries its prompt once. If the second attempt also triggers detection, the node is marked `error` and excluded from cross-check and synthesis entirely.

| Pattern checked | Reason |
|---|---|
| `placeholder`, `lorem ipsum` | Template filler — model did not fill in the content |
| `n/a`, `not available`, `not applicable` | Model acknowledged missing data rather than reasoning from available context |
| `to be determined`, `tbd` | Incomplete response |
| `…`, `[...]` | Ellipsis placeholder — truncated or unfinished output |
| Reasoning field under 50 characters | Too brief to represent genuine analytical reasoning |

---

## Rate Limiting

All limits are enforced by a Redis-backed token bucket and are fully configurable via environment variables. The burst limit prevents hammering during a single session; the hourly and daily limits protect the shared HuggingFace free-tier quota.

| Tier | Default limit | Scope |
|---|---|---|
| Burst | 1 request per 2 seconds | Per user |
| Hourly | 50 requests per hour | Per user |
| Daily | 800 requests per day | Global |

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus

cp .env.example .env
# Open .env and set HF_API_TOKEN and SECRET_KEY

docker compose up --build
```

All four services start together:

| Service | Address |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

The frontend Docker build runs `npm install` at container start — first boot takes a moment while dependencies download.

### Manual Development

```bash
# Backend — create virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# Frontend — install Node dependencies
cd frontend && npm install && cd ..

# Start only the infrastructure services
docker compose up -d postgres redis

# Run the backend (port 8000)
uvicorn backend.main:app --reload --port 8000

# Run the frontend dev server (separate terminal, port 5173)
cd frontend && npm run dev
```

The backend starts and runs in standalone mode even without Redis and PostgreSQL — it logs a warning and the WebSocket analysis pipeline still functions, but session persistence and rate limiting are unavailable.

### Test the WebSocket

A standalone test script is included for validating the full pipeline without the UI:

```bash
pip install websockets
python test_ws_dynamic_nodes.py
```

The script connects via WebSocket, submits a medical chest pain scenario, logs every event with a timestamp and elapsed time, and prints a final summary with event counts and total pipeline duration.

---

## Configuration

All configuration is via the `.env` file. Copy `.env.example` and fill in your values:

```env
# HuggingFace — get your token at huggingface.co/settings/tokens
HF_API_TOKEN=hf_your_token_here
HF_PRIMARY_MODEL=mistralai/Mistral-7B-Instruct-v0.3
HF_FALLBACK_1=HuggingFaceH4/zephyr-7b-beta
HF_FALLBACK_2=microsoft/Phi-3-mini-4k-instruct
HF_MAX_NEW_TOKENS=512
HF_TIMEOUT=30

# Rate limits (requests)
HF_DAILY_LIMIT=800
HF_HOURLY_LIMIT=50

# Backend
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/cortex
REDIS_URL=redis://localhost:6379
SECRET_KEY=replace-with-a-long-random-string
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

---

<div align="center">

Built by <a href="https://github.com/MKarthik730">MKarthik730</a> · MIT License

</div>
