# Cognitus

> Multi-perspective AI reasoning platform powered by HuggingFace LLMs.

Cognitus routes any situation or question through multiple domain-expert AI agents simultaneously. Each expert analyzes from their domain's lens. A cross-check coordinator finds contradictions. A chief synthesizer produces the final verdict. Everything streams in real-time to an animated React Flow graph.

## Architecture

```
                    ┌──────────────┐
                    │   User       │
                    │   Input      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Distributor  │
                    │ (Domain Sel) │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼─────┐ ┌───▼────┐ ┌────▼──────┐
       │ Expert 1   │ │Expert 2│ │ Expert N  │
       │ (Legal)    │ │(Finance)│ │(Medical)  │
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
| 1 | **Distributor** | Classifies input and selects 3-5 most relevant expert domains |
| 2 | **Experts** (parallel) | Each domain expert analyzes from their specialized perspective |
| 3 | **Cross-Check** | Finds contradictions and agreements across all expert outputs |
| 4 | **Synthesizer** | Produces a unified verdict reconciling all perspectives |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM Provider | HuggingFace Inference API |
| Orchestration | LangGraph |
| Backend | FastAPI + Uvicorn |
| WebSockets | FastAPI WebSocket + asyncio |
| Database | PostgreSQL 16 (async via asyncpg) |
| ORM | SQLAlchemy 2.0 async |
| Cache | Redis 7 |
| Auth | JWT + bcrypt |
| Frontend | React 18 + Vite + TypeScript |
| Graph UI | React Flow |
| Animation | Framer Motion |
| State | Zustand |
| Styling | Tailwind CSS |
| Container | Docker + Docker Compose |

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose
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

# Start infrastructure
docker compose up -d postgres redis

# Run backend
uvicorn backend.main:app --reload --port 8000

# Run frontend (separate terminal)
cd frontend && npm run dev
```

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
│   │   ├── agents/         # LLM-powered agent nodes
│   │   │   ├── distributor.py
│   │   │   ├── expert_node.py
│   │   │   ├── cross_check.py
│   │   │   └── synthesizer.py
│   │   ├── graph/          # LangGraph state machine
│   │   │   ├── state.py
│   │   │   └── council_graph.py
│   │   ├── api/            # FastAPI routes + WebSocket
│   │   │   ├── routes/
│   │   │   │   ├── auth.py
│   │   │   │   ├── sessions.py
│   │   │   │   └── analyze.py
│   │   │   └── websocket.py
│   │   ├── core/           # Config, DB, security
│   │   │   ├── config.py
│   │   │   ├── database.py
│   │   │   └── security.py
│   │   ├── services/       # HF API, rate limiter, cache
│   │   │   ├── hf_service.py
│   │   │   ├── rate_limiter.py
│   │   │   ├── cache.py
│   │   │   └── queue_worker.py
│   │   ├── models/         # SQLAlchemy ORM models (7 tables)
│   │   └── schemas/        # Pydantic request/response schemas
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph/       # React Flow canvas + nodes
│   │   │   ├── QueryBar.tsx
│   │   │   ├── ConsensusMeter.tsx
│   │   │   ├── SynthesisPanel.tsx
│   │   │   └── RateLimitBanner.tsx
│   │   ├── stores/          # Zustand state management
│   │   ├── hooks/           # WebSocket hook
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── postgres/
│   └── init.sql
├── docker-compose.yml
└── .env.example
```

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
