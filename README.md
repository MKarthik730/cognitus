# Cognitus

> Multi-perspective AI reasoning platform powered by HuggingFace LLMs.

Cognitus routes any situation or question through dynamically selected domain-expert AI agents in real time. Before analysis begins, a lightweight **Node Selector** (running `meta-llama/Llama-3.2-1B-Instruct`) evaluates the question and picks 3–5 relevant expert roles on the fly — no hardcoded panels. Each expert analyzes from their domain's lens, a cross-check coordinator finds contradictions, and a chief synthesizer produces the final verdict. Everything streams to an animated canvas graph via WebSocket.

## Architecture

```
                    ┌──────────────┐
                    │   User       │
                    │   Input      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Node Selector │
                    │ (Dynamic)    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼─────┐ ┌───▼────┐ ┌────▼──────┐
       │ Expert 1   │ │Expert 2│ │ Expert N  │
       └──────┬─────┘ └───┬────┘ └────┬──────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │ Cross-Check  │
                    │ Coordinator  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Synthesizer │
                    │  (Verdict)   │
                    └──────────────┘
```

### Pipeline Steps

| Step | Node | Description |
|------|------|-------------|
| 1 | **Node Selector** | Dynamically selects 3–5 domain experts via LLM |
| 2 | **Experts** (parallel) | Each expert analyzes from their specialized perspective |
| 3 | **Cross-Check** | Finds contradictions and agreements across all expert outputs |
| 4 | **Synthesizer** | Produces a unified verdict reconciling all perspectives |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM Provider | HuggingFace Inference API (Router) |
| Backend | FastAPI + Uvicorn + WebSockets |
| Frontend | Vanilla JS + Canvas API + Vite |
| Database | PostgreSQL 16 (async via asyncpg) |
| ORM | SQLAlchemy 2.0 async |
| Cache | Redis 7 |
| Auth | JWT + bcrypt |
| Container | Docker + Docker Compose |

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (optional, for postgres/redis)
- HuggingFace API token ([get one free](https://huggingface.co/settings/tokens))

## Quick Start

```bash
# Clone and enter
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus

# Environment
cp .env.example .env
# Edit .env with your HF_API_TOKEN and a SECRET_KEY

# Start everything with Docker
docker compose up --build
```

### Manual Development Setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm install
cd ..

# Start infrastructure (or set REDIS_URL / DATABASE_URL to skip)
docker compose up -d postgres redis

# Run backend (port 8000)
uvicorn backend.main:app --reload --port 8000

# Run frontend (separate terminal, port 5173)
cd frontend && npm run dev
```

> **Note:** The backend starts without Redis/Postgres — it logs a warning and runs in standalone mode for WebSocket testing.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/sessions` | List user sessions |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/{id}` | Get session |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/analyze` | Run council analysis |
| GET | `/api/analyze/{id}` | Get completed analysis |
| WS | `/ws/{session_id}` | Real-time streaming graph events |
| GET | `/api/nodes` | List available expert domains |
| GET | `/health` | Health check |

## Project Structure

```
cognitus/
├── backend/
│   ├── app/
│   │   ├── agents/              # LLM-powered agent nodes
│   │   │   ├── distributor.py
│   │   │   ├── expert_node.py
│   │   │   ├── cross_check.py
│   │   │   └── synthesizer.py
│   │   ├── graph/               # LangGraph state machine
│   │   │   ├── state.py
│   │   │   └── council_graph.py
│   │   ├── api/                 # FastAPI routes + WebSocket
│   │   │   ├── routes/
│   │   │   │   ├── auth.py
│   │   │   │   ├── sessions.py
│   │   │   │   └── analyze.py
│   │   │   └── websocket.py
│   │   ├── core/                # Config, DB, security
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   └── security.py
│   │   ├── services/            # HF API, node selector, etc.
│   │   │   ├── hf_service.py
│   │   │   ├── node_selector.py
│   │   │   ├── rate_limiter.py
│   │   │   ├── cache.py
│   │   │   └── queue_worker.py
│   │   ├── models/              # SQLAlchemy ORM models (7 tables)
│   │   └── schemas/             # Pydantic request/response schemas
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app.js               # Main application logic
│   │   ├── store.js             # Reactive state store
│   │   ├── canvas.js            # Canvas graph rendering
│   │   ├── api.js               # WebSocket + HTTP client
│   │   ├── utils.js             # Helpers, colors, markdown
│   │   ├── main.js              # Entry point
│   │   └── styles.css           # All styles (no CSS framework)
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml
└── .env.example
```

## Dynamic Node Selection

Instead of a static panel of experts, Cognitus uses a **Node Selector** call before analysis:

1. The question is sent to `meta-llama/Llama-3.2-1B-Instruct` with a prompt asking for 3–5 domain-specific expert roles
2. Response is parsed via a 3-layer regex extraction pipeline (dash lines → bold text → capitalized words)
3. Each selected node gets an auto-generated role description and behavior prompt
4. Nodes appear in the left panel with a staggered fade-in animation
5. On parse failure, falls back to 3 generic nodes: Analyst, Critic, Synthesist

Model fallback chain: `Llama-3.2-1B-Instruct` → `DeepSeek-R1-Distill-Qwen-1.5B` → `Arch-Router-1.5B`

## Rate Limits

HuggingFace free tier limits enforced by the platform:
- 800 requests/day global
- 50 requests/hour per user
- 1 request per 2 seconds burst

## Database Schema

7 tables:
- `users` — authentication and profiles
- `sessions` — user query sessions
- `analyses` — per-session analysis runs
- `expert_responses` — individual expert outputs
- `contradictions` — cross-check contradictions
- `agreements` — cross-check agreements
- `api_usage_log` — rate limit tracking

## License

MIT
