# Cognitus

> **Multi-perspective AI reasoning platform** powered by HuggingFace LLMs — with full dynamic node selection and Case Study Mode.

Cognitus assembles a council of AI expert agents to analyze any situation from multiple domain perspectives, then cross-checks and synthesizes their findings into a unified verdict. Everything streams in real-time to an animated canvas graph via WebSocket.

---

## Overview

Cognitus operates in two modes:

| Mode | Description |
|------|-------------|
| **Standard Mode** | Type a question and get analysis from dynamically selected AI expert agents in real time. The **Node Selector** picks 3–5 domain-specific expert roles based on your question. |
| **Case Study Mode** | Upload real case files (PDFs, images, documents), define custom expert nodes with tailored behaviors, and run a grounded multi-agent analysis on the uploaded content. |

Both modes stream every step (node selection → expert processing → cross-checking → synthesis) to an animated canvas graph via WebSocket.

---

## Architecture

### Pipeline

```
User Input / Case Files
        │
        ▼
┌───────────────┐
│ Node Selector │  (Standard: LLM selects 3–5 domain experts dynamically)
│  or           │  (Case Study: User defines 2–6 custom expert nodes)
│ Node Builder  │
└───────┬───────┘
        │
        ▼
┌──────────────────┐
│ Expert Nodes     │  All expert nodes run in PARALLEL
│ (3–10 experts)   │  Each receives the same situation/case context
└──────┬───────┬───┘
       │       │
       ▼       ▼
┌──────────────────┐
│ Cross-Check      │  Compares all expert analyses
│                  │  Identifies contradictions & agreements
│                  │  Computes consensus score
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Synthesizer      │  Produces final unified verdict
│                  │  Critical findings, recommendations
└──────────────────┘
```

### System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Frontend   │────▶│   Backend    │────▶│ HuggingFace │
│  (Vite +    │◀───▶│  (FastAPI +  │    │ Router API  │
│   Canvas)   │  WS │   Uvicorn)   │    │             │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  PostgreSQL │
                    │  + Redis    │
                    └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **LLM Provider** | HuggingFace Inference API (Router) — with automatic model fallback chain |
| **Backend** | Python 3.12, FastAPI, Uvicorn, WebSockets |
| **Frontend** | Vanilla JS, Canvas API, Vite 5 |
| **Document Extraction** | PDF.js (browser), mammoth.js (browser), PyMuPDF (server), python-docx (server) |
| **Database** | PostgreSQL 16 (async via asyncpg + SQLAlchemy 2.0) |
| **Cache** | Redis 7 |
| **Auth** | JWT + bcrypt (python-jose + passlib) |
| **LLM Resilience** | tenacity (exponential backoff retry with model fallback) |
| **State Machine** | LangGraph (council pipeline orchestration) |
| **Container** | Docker + Docker Compose |

---

## Backend Deep Dive

### Project Structure

```
backend/
├── main.py                        # FastAPI app entry, lifespan, CORS, router mounts
├── requirements.txt               # Python dependencies
├── Dockerfile                     # Production build
└── app/
    ├── agents/                    # LLM-powered agent nodes
    │   ├── distributor.py         # Domain classifier (legacy — selects 10 fixed domains)
    │   ├── expert_node.py         # Individual expert node with JSON-mode prompting
    │   ├── cross_check.py         # Cross-check analyst (compares all expert outputs)
    │   └── synthesizer.py         # Final synthesizer (produces unified verdict)
    ├── api/                       # FastAPI routes
    │   ├── routes/
    │   │   ├── auth.py            # POST /api/auth/register, POST /api/auth/login
    │   │   ├── sessions.py        # CRUD for analysis sessions
    │   │   └── analyze.py         # POST /api/analyze, GET /api/analyze/{id}
    │   ├── upload.py              # POST /api/case-study/upload (file extraction)
    │   └── websocket.py           # WS /ws/{session_id} (Standard + Case Study streaming)
    ├── core/
    │   ├── config.py              # Pydantic Settings (HF, DB, Redis, JWT, FAISS)
    │   ├── database.py            # Async SQLAlchemy engine + session
    │   └── security.py            # JWT creation/verification, password hashing
    ├── graph/                     # LangGraph state machine
    │   ├── state.py               # TypedDicts for all pipeline states
    │   └── council_graph.py       # StateGraph builder (distributor → experts → cross-check → synthesizer)
    ├── models/                    # SQLAlchemy ORM models
    │   ├── user.py                # users table
    │   ├── session.py             # sessions table
    │   ├── analysis.py            # analyses table
    │   ├── expert_response.py     # expert_responses table
    │   ├── contradiction.py       # contradictions table
    │   ├── agreement.py           # agreements table
    │   ├── api_usage_log.py       # api_usage_log table
    │   └── base.py                # Declarative base
    ├── schemas/                   # Pydantic request/response schemas
    │   ├── auth.py                # LoginRequest, RegisterRequest, TokenResponse
    │   ├── sessions.py            # SessionCreate, SessionResponse
    │   ├── analyze.py             # AnalyzeRequest, AnalysisResponse, etc.
    │   └── node_output.py         # NodeOutput, CrossExamineOutput, CrossCheckResult, SynthesisResult, DistributorResult
    └── services/                  # Business logic
        ├── hf_service.py          # HuggingFace Router client with retry + model fallback
        ├── node_selector.py       # Dynamic node selection via LLM (Standard Mode)
        ├── rate_limiter.py        # Redis-backed burst/hourly/daily rate limiting
        ├── cache.py               # Redis response cache (SHA256-keyed)
        └── queue_worker.py        # Redis-based async task queue for analysis jobs
```

### Agent Nodes

#### Distributor (`agents/distributor.py`)
- Legacy domain classifier — selects from 10 fixed domains: `legal`, `finance`, `medical`, `technology`, `education`, `science`, `business`, `ethics`, `psychology`, `sociology`
- Uses JSON-mode prompting with one retry on parse failure
- Fallback: `["technology", "business", "ethics"]`

#### Expert Node (`agents/expert_node.py`)
- Each domain has a handcrafted persona prompt with distinct personality, voice, and analytical style
- Responses parsed as **structured JSON** matching Pydantic `NodeOutput` schema:
  ```json
  {
    "confidence": 0-100,
    "position": "string",
    "reasoning": "string",
    "key_findings": ["string", ...],
    "concerns": ["string", ...],
    "revision": null
  }
  ```
- **Hallucination detection** via `is_hallucinated()` — checks for placeholder patterns (lorem ipsum, TBD, N/A, etc.) and minimum reasoning length
- Auto-retries once on parse failure or hallucination detection
- Can accept custom behavior prompts (used by Case Study and Node Selector)

#### Cross-Check (`agents/cross_check.py`)
- Compares all expert analyses pairwise
- Identifies contradictions (direct/partial/complementary) and agreements
- Computes consensus score (0.0–1.0)
- Structured JSON output with retry on parse failure

#### Synthesizer (`agents/synthesizer.py`)
- Receives situation, all expert outputs, and cross-check results
- Produces unified verdict with reasoning, confidence level, and consensus score
- Detects evenly split evidence (consensus_score ≈ 0.5 → "inconclusive")
- Structured JSON output with retry on parse failure

### Services

#### HF Service (`services/hf_service.py`)
- Sends requests to `https://router.huggingface.co/v1/chat/completions`
- **Model fallback chain**: Primary → Fallback 1 → Fallback 2 (configured in `.env`)
- **Automatic retry** with exponential backoff (tenacity) on `TimeoutException` and `RequestError`
- Uses `{model}:fastest` routing for optimal latency
- Also supports **image analysis** via `generate_with_image()` — sends text + base64 image data URI
- `summarize_text()` — truncates long documents (>6000 chars) via LLM summarization

#### Node Selector (`services/node_selector.py`)
- **Standard Mode** — uses `meta-llama/Llama-3.2-1B-Instruct` (or fallbacks) to dynamically select 3–5 domain-specific expert roles
- Prompt includes examples of role selection patterns for different domains
- **Triple fallback**: JSON parse → retry → text extraction (heuristic role matching) → 3 generic fallback nodes (Analyst, Critic, Synthesist)
- Each selected node gets auto-generated role description and behavior prompt

#### Rate Limiter (`services/rate_limiter.py`)
- Redis-backed token bucket:
  - **Burst**: 1 request per 2 seconds per user (sorted set with timestamps)
  - **Hourly**: 50 requests per user per hour
  - **Daily**: 800 requests global per day
- All configurable via `.env`

#### Cache (`services/cache.py`)
- SHA256-hashed response cache keyed by `{model}:{prompt}`
- 24-hour TTL (configurable)

#### Queue Worker (`services/queue_worker.py`)
- Redis list-based task queue (`analysis_queue`)
- Workers pop tasks via `BLPOP` and run the full `CouncilGraph`
- Results stored with 1-hour TTL, published via Redis Pub/Sub
- Graceful shutdown on app termination

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register new user (username, email, password) |
| POST | `/api/auth/login` | No | Login, get JWT access token |
| GET | `/api/sessions/` | JWT | List user sessions (paginated) |
| POST | `/api/sessions/` | JWT | Create session |
| GET | `/api/sessions/{id}` | JWT | Get session details |
| DELETE | `/api/sessions/{id}` | JWT | Delete session |
| POST | `/api/analyze/` | JWT | Run council analysis (REST) |
| GET | `/api/analyze/{id}` | JWT | Get completed analysis with all expert responses |
| WS | `/ws/{session_id}` | No | Real-time streaming graph events (Standard + Case Study) |
| POST | `/api/case-study/upload` | No | Upload file for server-side extraction (images) |
| GET | `/api/nodes` | No | List available expert domains |
| GET | `/health` | No | Health check |

### WebSocket Protocol

The WebSocket endpoint (`/ws/{session_id}`) streams real-time events:

**Standard Mode flow:**
1. Client sends `{ "situation": "...", "user_id": 0 }`
2. `node_selection_start` → `node_selection_complete` (with selected nodes)
3. `node_start` ("experts") → `expert_complete` (per expert) → `expert_error` (on failure)
4. `node_start` ("cross_check") → `node_complete` (cross_check data)
5. `node_start` ("synthesizer") → `node_complete` (synthesis data)
6. `complete` (final payload with all results)

**Case Study Mode flow:**
1. Client sends `{ "mode": "case_study", "nodes": [...], "caseContext": "...", "guidingQuestion": "..." }`
2. `case_node_start` ("experts") → `case_expert_complete` (per expert)
3. `case_cross_check` (status → data)
4. `case_synthesize` (status → data)
5. `case_complete` (final payload)

### Database Schema (PostgreSQL)

7 tables with full indexing:

- **users** — id, username, email, hashed_password, is_active, timestamps
- **sessions** — id, user_id (FK → users), title, situation (text), status, timestamps
- **analyses** — id, session_id (FK → sessions), distributor_output (JSON), cross_check_output (JSON), synthesis_output (JSON), consensus_score, status, completed_at, timestamps
- **expert_responses** — id, analysis_id (FK → analyses), domain, analysis_text, confidence, model_used, processing_time_ms, timestamps
- **contradictions** — id, analysis_id (FK → analyses), domain_a, domain_b, type, description, severity
- **agreements** — id, analysis_id (FK → analyses), domain_a, domain_b, points
- **api_usage_log** — id, user_id (FK → users), endpoint, model_used, tokens_used, ip_address, timestamps

---

## Frontend Deep Dive

### Project Structure

```
frontend/
├── index.html              # Single HTML with all UI elements
├── package.json            # Vite + vanilla JS (no framework)
├── vite.config.ts          # Dev server with proxy to backend
├── tsconfig.json           # TypeScript config (JSDoc-compatible)
└── src/
    ├── main.js             # Entry point — imports styles, inits app
    ├── app.js              # Main application logic, event handlers, file extraction
    ├── store.js            # Reactive state store with subscriptions
    ├── canvas.js           # Canvas graph rendering with minimap + animations
    ├── api.js              # WebSocket client with reconnection, HTTP client
    ├── utils.js            # Helpers: markdown, colors, presets, file icons
    └── styles.css          # Complete CSS (dark theme, no framework)
```

### Core Features

#### Store (`store.js`)
- Simple reactive state store with `subscribe(key, fn)` pattern
- Central state includes: situation, status, dynamicNodes, experts, contradictions, synthesis, connectionStatus, caseStudy
- `handleWsEvent()` — processes all WebSocket event types into state updates

#### API Client (`api.js`)
- **WebSocket reconnection** with exponential backoff (1s–30s) and jitter
- Max 10 reconnection attempts with automatic replay of pending request
- Connection status tracking (`connected`, `disconnected`, `connecting`, `reconnecting`)
- Reconnect indicator UI with attempt counter
- HTTP client for REST endpoints (sessions, auth)

#### Canvas Graph (`canvas.js`)
- Real-time animated graph showing the council pipeline
- Nodes: Distributor → Expert nodes (dynamic layout) → Cross-Check → Synthesizer
- **Animated edges** with gradient glow and pulsing dots on active connections
- Dark theme with `#0a0f1e` background
- **Mini-map** in bottom-right corner
- **Pan** (click-and-drag) and **zoom** (scroll wheel) with controls
- Staggered fade-in animation for expert nodes
- Color-coded by expert domain with confidence indicators

#### File Extraction (`app.js`)
| File Type | Browser-side | Server-side |
|-----------|-------------|-------------|
| PDF | PDF.js | PyMuPDF (fitz) |
| DOCX | mammoth.js | python-docx |
| PNG/JPG/WEBP | — | HF API image analysis |
| TXT/MD/CSV | FileReader API | — |

- Drag-and-drop with visual feedback
- Per-file extraction status chips (spinner → ✓/✗)
- Failed files show retry button, excluded from analysis
- Auto-summarization for long documents (>6000 chars)

#### Node Builder (Case Study Mode)
- Create 2–6 custom expert nodes
- Each node has: **Name**, **Role** (one-line), **Behavior** (full system prompt)
- **8 preset colors** per node with color picker popup
- **Collapse/expand** — toggle to show only the name
- **Duplicate** — clone a node with "(copy)" suffix
- **Delete** — disabled when only 2 nodes remain
- **Preset templates** — one-click load:
  - Medical Team (4 nodes)
  - Detective Squad (3 nodes)
  - Startup Review (3 nodes)
  - Legal Panel (2 nodes)
  - Engineering Review (4 nodes)
  - Custom (starts empty)
- Each preset ships with detailed behavior prompts and named personas

#### Analysis Outputs
- **Verdict tab**: Verdict card · Confidence badge (high/medium/low) · Consensus meter (0–100% gradient bar) · Reasoning block · Condensed banner · Critical Findings · Unresolved Disagreements · Numbered Recommendations
- **Node Outputs tab**: One card per expert with color-coded left border · position · key findings · concerns · collapsible reasoning
- **Cross-Check card**: Consensus · Conflicts · Strongest Argument · Unanswered questions · Quality assessment

### Reconnection UX

When the WebSocket drops during processing:

1. Reconnect indicator appears at top center with pulsing dot
2. Shows attempt counter: "Reconnecting (attempt 3)…"
3. Up to 10 attempts with exponential backoff + jitter
4. On success: "Reconnected ✓" — auto-hides after 2 seconds
5. On failure: shows error message, resets to idle

---

## Configuration

All configuration via `.env` file:

```env
# HuggingFace
HF_API_TOKEN=your_hf_token_here                    # Required
HF_PRIMARY_MODEL=mistralai/Mistral-7B-Instruct-v0.3
HF_FALLBACK_1=HuggingFaceH4/zephyr-7b-beta
HF_FALLBACK_2=microsoft/Phi-3-mini-4k-instruct
HF_MAX_NEW_TOKENS=512
HF_TIMEOUT=30
HF_DAILY_LIMIT=800
HF_HOURLY_LIMIT=50

# Backend
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/cortex
REDIS_URL=redis://localhost:6379
SECRET_KEY=<your-secret-key>
ACCESS_TOKEN_EXPIRE_MINUTES=30

# FAISS
FAISS_INDEX_PATH=./data/faiss
```

---

## Quick Start

### Docker (Recommended)

```bash
# Clone and enter
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus

# Environment
cp .env.example .env
# Edit .env with your HF_API_TOKEN and a SECRET_KEY

# Start everything
docker compose up --build
```

This starts:
- **PostgreSQL 16** on port 5432
- **Redis 7** on port 6379
- **Backend** (FastAPI) on port 8000
- **Frontend** (Vite) on port 5173

> **Note:** The Docker frontend build uses `npm install` at container start, so first boot may take a moment.

### Manual Development Setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
pip install PyMuPDF python-docx   # for file extraction

# Frontend
cd frontend
npm install
cd ..

# Start infrastructure (or set REDIS_URL / DATABASE_URL to existing instances)
docker compose up -d postgres redis

# Run backend (port 8000)
uvicorn backend.main:app --reload --port 8000

# Run frontend (separate terminal, port 5173)
cd frontend && npm run dev
```

> **Note:** The backend starts without Redis/Postgres — it logs a warning and runs in standalone mode (no queue worker). WebSocket analysis still works.

### Testing WebSocket

A standalone test script is included:

```bash
# Ensure backend is running on port 8001 (or update URL in script)
pip install websockets
python test_ws_dynamic_nodes.py
```

The script:
1. Connects via WebSocket
2. Sends a medical chest pain scenario
3. Logs all events with timing (node selection, expert responses, cross-check, synthesis)
4. Prints a summary with event counts and elapsed time

---

## Pipeline

### Standard Mode: Dynamic Node Selection

1. User types a question
2. **Node Selector** (`meta-llama/Llama-3.2-1B-Instruct`) evaluates the question
3. Returns 3–5 domain-specific expert roles with auto-generated behavior prompts
4. Falls back through model chain: Llama-3.2-1B → DeepSeek-R1-Distill-Qwen-1.5B → Arch-Router-1.5B
5. On complete failure: 3 generic fallback nodes (Analyst, Critic, Synthesist)
6. All expert nodes run in parallel, each receiving the same situation
7. Cross-check compares all outputs → Synthesis produces final verdict

### Case Study Mode: Custom Node Analysis

1. Switch to **Case Study** tab
2. Upload case files (PDF, DOCX, images, text)
3. Define 2–6 custom expert nodes (or load a preset template)
4. Optionally set a guiding question
5. On analyze:
   - Files are extracted (browser-side for PDF/DOCX/text, server-side for images)
   - If total content > 6000 chars, per-file LLM summarization
   - If still > 10000 chars, global compression pass
   - "Case files condensed" banner shown when applicable
   - All nodes receive the same compressed case context
   - Pipeline runs: parallel expert analysis → cross-check → synthesis

---

## Rate Limits

HuggingFace free tier limits enforced by the platform:
- 800 requests/day global
- 50 requests/hour per user
- 1 request per 2 seconds burst

Redis-backed rate limiter enforces all three tiers with automatic counter reset.

---

## Hallucination Detection

The `is_hallucinated()` function in `schemas/node_output.py` checks for:

| Pattern | Reason |
|---------|--------|
| `placeholder` | Placeholder text |
| `lorem ipsum` | Filler text |
| `n/a` | Missing data |
| `not available` | Missing data |
| `not applicable` | Missing data |
| `to be determined` | TBD |
| `tbd` | TBD abbreviation |
| `…` / `\ldots` | Ellipsis placeholder |
| `[...]` | Bracket ellipsis |
| Reasoning < 50 chars | Too short to be meaningful |

On detection, the expert node retries once. If both attempts fail, the node is marked as error and excluded from synthesis.

---

## License

MIT
