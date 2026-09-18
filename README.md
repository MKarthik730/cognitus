# Cognitus

> Multi-perspective AI reasoning platform — parallel expert agents, structured JSON analysis, real-time streaming canvas, and a deterministic PR-review trust layer.

Cognitus runs a question (or a GitHub PR) through a panel of AI experts that argue, cross-examine each other, and converge on a forced-commitment verdict — instead of asking one model for one answer. Everything streams to an animated canvas graph over WebSocket in real time.

## Modes

| Mode | Input | What happens |
|---|---|---|
| **Standard** | A question or situation | Distributor decomposes it into 3–5 sub-questions, an LLM-picked expert panel analyzes each in parallel, cross-examines, and synthesizes a verdict. |
| **Deep Research** | A question | Same pipeline, but first pulls live context from public sources (arXiv, NVD, SEC EDGAR, Hacker News, PubMed, CourtListener, and more, picked by topic). |
| **Debate** | A proposition | Fixed For / Against / Arbitrator roster argues both sides; the arbitrator picks the stronger case. |
| **Engineering** | A technical question | Standard pipeline steered toward engineering questions, with CVE/security context pulled in automatically. |
| **Case Study** | Uploaded files (PDF/DOCX/image/text) | Define 2–6 custom expert nodes (or use a preset panel) and have them deliberate over the uploaded material with RAG-based retrieval. |
| **Verdict** | A GitHub PR URL | Deterministic checks + an opinion panel + evidence-based claim verification decide whether to auto-approve the PR or file a GitHub issue explaining exactly what's wrong. See [Verdict](#verdict) below. |

---

## Architecture

![Cognitus Architecture](./docs/architecture.svg)

## Pipeline

![Cognitus Pipeline](./docs/pipeline.svg)

## WebSocket Event Flow

![Cognitus WebSocket Flow](./docs/websocket.svg)

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM Provider | Local llama.cpp OpenAI-compatible API (default), pluggable to any OpenAI-compatible endpoint |
| Backend | FastAPI + Uvicorn + WebSockets |
| Frontend | React 18 + TypeScript + Vite + Zustand + Tailwind CSS |
| Document Extraction | PDF.js (browser) · mammoth.js (browser) · PyMuPDF (server) · python-docx (server) |
| Database | PostgreSQL 16 + pgvector (async via asyncpg) |
| ORM | SQLAlchemy 2.0 async |
| Cache | Redis 7 |
| Auth | JWT + bcrypt |
| Embeddings | sentence-transformers all-MiniLM-L6-v2 (local) |
| Verdict sandbox | Docker (ephemeral containers for real test execution) |
| Verdict static analysis | bandit (Python), regex/entropy secret scanner |
| Verdict CVE data | NVD CVE API (keyless) |
| Container | Docker + Docker Compose |

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (required for Postgres/Redis, and for Verdict's sandboxed test runner)
- A local llama.cpp server (default), or an API key for any OpenAI-compatible provider

---

## Quick Start

```bash
# Clone
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus/council

# Environment
cp .env.example .env
# Edit .env — at minimum confirm LLAMA_CPP_BASE_URL, or switch LLM_MODE to a remote provider

# Start everything
docker compose up --build
```

Frontend: http://localhost:5173
Backend API: http://localhost:8001
API docs: http://localhost:8001/docs

---

## Manual Development Setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Infrastructure
docker compose up -d postgres redis

# Backend (port 8001)
uvicorn main:app --app-dir backend --reload --port 8001

# Frontend (port 5173) — separate terminal
cd frontend && npm run dev
```

> The backend starts without Redis/Postgres — it logs a warning and runs in standalone mode for WebSocket testing.

---

## Local LLM

Run llama.cpp's OpenAI-compatible server on `http://localhost:8000` with the `qwen2.5-1.5b-instruct-q4_k_m.gguf` model:

```bash
llama-server -m qwen2.5-1.5b-instruct-q4_k_m.gguf --port 8000
```

Cognitus connects to `http://localhost:8000/v1` (`LLAMA_CPP_BASE_URL`); its own API runs on port 8001. To use a different backend, point `LLAMA_CPP_BASE_URL` at any OpenAI-compatible endpoint, or change `LLM_MODE` and configure the matching provider block in `.env`.

**Legacy HuggingFace fallback chain** (used when the primary LLM call fails, e.g. for image analysis): `Mistral-7B-Instruct-v0.3` → `zephyr-7b-beta` → `Phi-3-mini-4k-instruct`.

---

## Verdict

Verdict turns a GitHub PR URL into an auto-approve/block decision that isn't just an LLM's opinion — it's a hard gate over separately-verifiable facts.

### Pipeline

1. **Ingest** — fetch the PR's diff, metadata, and files-changed via the GitHub API (`app/ingestion/github_client.py`).
2. **Deterministic checks** — five checks, none of them LLM calls, each producing a `pass` / `fail` / `error` / `skipped_no_data` result:

   | Check | What it does |
   |---|---|
   | `tests` | Spins up a short-lived Docker container, clones the PR's head commit, detects the test command, and runs the real test suite (`app/verification/sandbox_runner.py`). |
   | `static_analysis` | Runs bandit against the changed Python files, keeping only findings on lines the diff actually touched (`static_analysis.py`). |
   | `coverage` | Intersects the sandbox's per-line coverage data with the diff's changed lines — "tests pass" and "this code was exercised" are checked separately (`coverage_check.py`). |
   | `cve` | Diffs the dependency manifest before/after the PR and queries the NVD CVE API for each newly-added package (`dependency_scanner.py`). |
   | `secrets` | Regex/entropy scan of added diff lines only, for hardcoded credentials (`secret_scanner.py`). |

   `skipped_no_data` (e.g. no test suite found) is **never** treated as a pass — that distinction is deliberate.

3. **Opinion panel** — Backend / Security / DevOps / QA expert nodes review the diff and produce structured `NodeOutput`-shaped findings (LLM, same schema as Standard mode's expert nodes).
4. **Claim matching** — `app/agents/claim_matcher.py` checks every claim the PR description or opinion panel makes against the actual diff, and must either quote the exact supporting lines or mark the claim `unsupported`/`mismatch`/`partial`. No claim is taken at face value.
5. **Gate** — `app/agents/verdict_synthesizer.py` is a plain Python function, not a prompt:

   ```python
   auto_approved  ⟺  all(check.status == "pass" for check in deterministic_checks)
                  and all(claim.verdict == "match" for claim in claim_matches)
   ```

   If the gate opens, Verdict posts a real GitHub PR review. If it doesn't, Verdict files a GitHub issue itemizing exactly which check or claim failed — never a single collapsed "looks fine" sentence.

### Output shape

`VerdictScorecard` (`app/schemas/verdict_output.py`): `pr_url`, `deterministic_checks[]`, `opinion_findings[]`, `claim_matches[]`, `unintended_scope[]`, `action_taken` (`auto_approved` | `blocked_for_review` | `issue_filed`), `action_reason`.

### Running it

- **UI:** pick the **Verdict** mode card, paste a PR URL — live progress streams over the existing `/ws/{session_id}` connection (`mode: "verdict"`), rendered by `VerdictScorecardPanel.tsx` with a `GateIndicator.tsx` showing locked/unlocked state.
- **API:** `POST /api/verdict/analyze` — synchronous, for CI/curl/eval-harness use (see [API Reference](#api-reference)).
- **Requires:** `GITHUB_TOKEN` (fine-grained PAT, `pull_requests:write` + `contents:read` on the target repo) and a reachable Docker daemon for the sandbox test runner.

### Eval harness

```bash
python -m backend.evals.verdict_runner --all
```

Fixtures in `backend/evals/verdict_fixtures.json`: `clean_pr` (all checks pass, claim verified → `auto_approved`), `deceptive_pr` (claim doesn't match the diff → `blocked_for_review`), `no_tests_pr` (no test suite found → `blocked_for_review`, since `skipped_no_data` never counts as a pass).

---

## Features

### Standard Mode

The Distributor breaks the question into 3–5 domain-specific sub-questions. The Node Selector (LLM call) picks expert roles on the fly — roles appear in the left panel with a staggered fade-in. Each expert receives their sub-question plus full context and responds as structured JSON (`NodeOutput` schema). On parse failure, falls back to 3 generic nodes: Analyst, Critic, Synthesist.

### Deep Research Mode

Before the expert panel runs, `app/services/live_sources.py` pulls live results from a curated, key-free catalog of public sources (arXiv, NVD, SEC EDGAR, Hacker News, PubMed, CourtListener, and more), selected by topic and surfaced via `GET /api/sources`. Each expert receives the retrieved context alongside their sub-question.

### Debate Mode

`app/agents/debate.py` runs a fixed three-role roster — For, Against, Arbitrator — instead of a dynamically-selected panel. The Arbitrator receives both sides' full arguments and renders a reasoned decision on which case was stronger.

### Engineering Mode

Standard pipeline with `app/services/enrichment.py`'s NVD CVE lookups wired in automatically, so technical questions get real vulnerability data instead of relying on model recall.

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

### Token Streaming

Backend yields tokens from the LLM as they arrive, sending `node_token` WebSocket events. The canvas shows a pulsing border glow and live character count inside each node circle while streaming; on `node_complete`, the full structured JSON is parsed and rendered.

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

### Ghost Mode

`GHOST_MODE` (`off | fog | shadow | void | phantom`, `app/services/ghost_mode.py`) controls how much of a session gets persisted/logged, trading auditability for privacy. Configurable in the Settings panel.

### Interactive Canvas

- **Node click** — hit-test by distance, scrolls to the matching node card with a ring animation
- **Confidence arc** — thin arc around each node circle, fill % = confidence score, gradient red → yellow → green
- **Bezier edges** — colored by agreement (green/red/yellow), thickness proportional to confidence delta; hover tooltip shows agreement summary
- **Zoom & pan** — mouse wheel zoom, click-drag on empty space to pan, double-click to reset fit
- **Minimap** — bottom-right corner, full graph at reduced scale with viewport rectangle overlay

### Follow-Up Conversation

After analysis completes, a chat input appears below the verdict panel. Each message is sent over the existing WebSocket connection as `{ type: "chat_message", content, analysis_context }`; `app/services/chat_router.py` picks which node/persona should respond and streams the reply back as tokens.

### Export

| Option | Endpoint | Output |
|---|---|---|
| Export as PDF | `POST /api/export/pdf` | Multi-page PDF (verdict, per-node sections, synthesis) |
| Export Verdict as PDF | `POST /api/export/verdict-pdf` | Multi-page PDF of a Verdict scorecard |
| Export as JSON | `GET /api/export/json/{session_id}` | Full analysis state |
| Share link | `POST /api/export/share` | Signed JWT, read-only `/view/{session_id}` |

### WebSocket Resilience

Auto-reconnect with exponential backoff. On reconnect, the frontend sends `{ type: 'resume', session_id, last_event_id }`; the backend replays missed events from Redis and recovers partial node results.

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
| WS | `/ws/{session_id}` | Real-time streaming graph events (standard/deep-research/debate/engineering/case-study/verdict modes, plus post-analysis chat) |
| POST | `/api/case-study/upload` | Upload file for case study |
| DELETE | `/api/cache/{session_id}` | Clear result cache for session |
| PATCH | `/api/config` | Update runtime LLM/config settings |
| GET | `/api/sources` | Curated live-research source catalog |
| POST | `/api/plan` | Planner LLM endpoint (question → sub-plan) |
| GET | `/api/presets` | List custom node presets |
| POST | `/api/presets` | Create preset |
| POST | `/api/presets/{id}/use` | Mark preset used |
| DELETE | `/api/presets/{id}` | Delete preset |
| POST | `/api/graph/inject-node` | Inject an ad-hoc node into a running session |
| POST | `/api/verdict/analyze` | Run the Verdict pipeline against a PR synchronously (non-streaming) |
| POST | `/api/export/pdf` | Export analysis as PDF |
| POST | `/api/export/verdict-pdf` | Export a Verdict scorecard as PDF |
| GET | `/api/export/json/{session_id}` | Export analysis as JSON |
| POST | `/api/export/share` | Create a signed read-only share link |
| GET | `/view/{session_id}` | Read-only shared viewer |
| POST | `/api/admin/eval/run` | Run the council eval suite (requires `X-Admin-Secret` header) |
| GET | `/health` | Health check |

---

## Eval Harness

```bash
# Council eval fixtures (medical, detective, startup, legal, engineering)
python -m backend.evals.runner --all
python -m backend.evals.runner --fixture medical

# Verdict fixtures (clean_pr, deceptive_pr, no_tests_pr)
python -m backend.evals.verdict_runner --all
```

Council fixtures define `min_consensus`, `required_findings`, `forbidden_content`, `min_node_confidence`, `synthesis_must_contain`, and the runner scores each check and prints a pass/fail table. Verdict fixtures assert the expected `action_taken` for a given scorecard shape. Admin API: `POST /api/admin/eval/run` (council suite only) — requires `ADMIN_SECRET` env var, passed as `X-Admin-Secret` header.

---

## Project Structure

```
council/
├── backend/
│   ├── app/
│   │   ├── agents/
│   │   │   ├── distributor.py
│   │   │   ├── expert_node.py        # JSON parsing, hallucination check, streaming, caching, RAG
│   │   │   ├── cross_check.py
│   │   │   ├── synthesizer.py
│   │   │   ├── debate.py             # For/Against/Arbitrator roster
│   │   │   ├── assumption_excavator.py
│   │   │   ├── cascade_mapper.py
│   │   │   ├── iceberg.py
│   │   │   ├── pre_mortem.py
│   │   │   ├── reverse_engineer.py
│   │   │   ├── signal_noise.py
│   │   │   ├── stress_tester.py
│   │   │   ├── claim_matcher.py      # Verdict: evidence-matches-claim check
│   │   │   └── verdict_synthesizer.py # Verdict: hardcoded pass/fail gate
│   │   ├── verification/             # Verdict's deterministic (no-LLM) checks
│   │   │   ├── sandbox_runner.py     # Docker-based real test execution
│   │   │   ├── static_analysis.py    # bandit, diff-scoped
│   │   │   ├── coverage_check.py     # diff-line coverage
│   │   │   ├── dependency_scanner.py # NVD CVE lookups on new deps
│   │   │   ├── secret_scanner.py     # regex/entropy, added lines only
│   │   │   └── diff_utils.py
│   │   ├── ingestion/
│   │   │   └── github_client.py      # PR fetch, review post, issue file
│   │   ├── graph/
│   │   │   ├── state.py
│   │   │   ├── council_graph.py      # cross_examine node wired in
│   │   │   └── verdict_graph.py      # Verdict pipeline orchestration
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── auth.py
│   │   │   │   ├── sessions.py
│   │   │   │   ├── analyze.py
│   │   │   │   ├── cache.py
│   │   │   │   ├── config_route.py   # PATCH /api/config
│   │   │   │   ├── eval.py
│   │   │   │   ├── export.py         # PDF + JSON + share link + verdict-pdf
│   │   │   │   ├── plan.py
│   │   │   │   ├── presets.py
│   │   │   │   ├── inject.py
│   │   │   │   ├── sources.py        # live research source catalog
│   │   │   │   └── verdict.py        # POST /api/verdict/analyze
│   │   │   ├── upload.py
│   │   │   └── websocket.py          # event_id, Redis history, resume, node_token, verdict + chat dispatch
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── database.py           # pgvector extension enabled
│   │   │   └── security.py
│   │   ├── services/
│   │   │   ├── llm_router.py         # routes to local llama.cpp or configured provider
│   │   │   ├── hf_service.py         # legacy HuggingFace fallback
│   │   │   ├── structured_llm.py     # Instructor-backed structured output
│   │   │   ├── node_selector.py
│   │   │   ├── planner.py
│   │   │   ├── chat_router.py        # post-analysis follow-up routing/streaming
│   │   │   ├── rate_limiter.py
│   │   │   ├── cache.py / cache_key.py
│   │   │   ├── embedder.py           # sentence-transformers + pgvector
│   │   │   ├── enrichment.py         # entity extraction + domain APIs
│   │   │   ├── live_sources.py       # Deep Research source catalog
│   │   │   ├── ghost_mode.py         # privacy levels
│   │   │   ├── redaction.py
│   │   │   ├── prompt_guard.py       # prompt injection guard
│   │   │   └── queue_worker.py
│   │   ├── models/                   # SQLAlchemy ORM (sessions, presets, analyses, users, chunks, ...)
│   │   └── schemas/
│   │       ├── node_output.py        # NodeOutput + CrossExamineOutput + ChatRouterResult
│   │       ├── verdict_request.py
│   │       └── verdict_output.py     # VerdictScorecard, DeterministicCheckResult, ClaimMatchResult
│   ├── evals/
│   │   ├── fixtures.json / runner.py             # council eval suite
│   │   └── verdict_fixtures.json / verdict_runner.py  # Verdict eval suite
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ModeSelector.tsx      # Standard/Deep Research/Debate/Engineering/Verdict cards
│   │   │   ├── AgentRoster.tsx
│   │   │   ├── GraphCanvas.tsx       # confidence arcs, bezier edges, zoom/pan, minimap
│   │   │   ├── SynthesisPanel.tsx
│   │   │   ├── VerdictScorecardPanel.tsx
│   │   │   ├── GateIndicator.tsx     # Verdict's locked/unlocked gate state
│   │   │   ├── CustomNodeBuilder.tsx # Case Study node builder + presets
│   │   │   ├── NodePopover.tsx
│   │   │   ├── InputBar.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── AuthModal.tsx
│   │   │   └── SettingsPanel.tsx
│   │   ├── stores/                   # Zustand: graphStore, settingsStore, authStore
│   │   ├── hooks/useWebSocket.ts     # CognitusSocket, exponential backoff, resume
│   │   ├── utils/specialModes.ts
│   │   └── types/index.ts
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
# ------------------------------------------------------------------
# Local LLM (default)
# ------------------------------------------------------------------
LLM_MODE=local
LLAMA_CPP_BASE_URL=http://localhost:8000/v1
LLAMA_CPP_MODEL=qwen2.5-1.5b-instruct-q4_k_m.gguf

# ------------------------------------------------------------------
# Deep Research
# ------------------------------------------------------------------
RESEARCH_ENABLED=true
RESEARCH_MAX_RESULTS=3
SEARXNG_BASE_URL=              # optional, only if self-hosting SearXNG

# ------------------------------------------------------------------
# Legacy HuggingFace (fallback for image analysis, etc.)
# ------------------------------------------------------------------
HF_API_TOKEN=
HF_PRIMARY_MODEL=mistralai/Mistral-7B-Instruct-v0.3
HF_FALLBACK_1=HuggingFaceH4/zephyr-7b-beta
HF_FALLBACK_2=microsoft/Phi-3-mini-4k-instruct
HF_DEFAULT_MAX_TOKENS=512
HF_EXPERT_MAX_TOKENS=512
HF_SYNTHESIS_MAX_TOKENS=2048
HF_NODE_SELECTOR_MAX_TOKENS=1024
HF_TIMEOUT=30
HF_DAILY_LIMIT=800
HF_HOURLY_LIMIT=50

# ------------------------------------------------------------------
# Ghost Mode
# ------------------------------------------------------------------
GHOST_MODE=off          # off | fog | shadow | void | phantom
GHOST_RATE_LIMIT_BURST=5
GHOST_RATE_LIMIT_HOURLY=20

# ------------------------------------------------------------------
# Backend / Infrastructure
# ------------------------------------------------------------------
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/cortex
REDIS_URL=redis://localhost:6379
SECRET_KEY=
ACCESS_TOKEN_EXPIRE_MINUTES=30
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
FAISS_INDEX_PATH=./data/faiss

# ------------------------------------------------------------------
# Enrichment Pipeline
# ------------------------------------------------------------------
TAVILY_API_KEY=
ENRICHMENT_ENABLED=true

# ------------------------------------------------------------------
# Eval Harness
# ------------------------------------------------------------------
ADMIN_SECRET=

# ------------------------------------------------------------------
# Verdict — GitHub PR ingestion + action layer
# ------------------------------------------------------------------
# Fine-grained PAT scoped to pull_requests:write + contents:read on the target repo.
GITHUB_TOKEN=
GITHUB_API_BASE_URL=https://api.github.com
```

---

## License

MIT
