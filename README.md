# Cognitus

> Multi-perspective AI reasoning platform powered by HuggingFace LLMs.

Cognitus routes any situation or question through multiple domain-expert AI agents simultaneously. Each expert analyzes from their domain's lens. A cross-check coordinator finds contradictions. A chief synthesizer produces the final verdict. Everything streams in real-time to an animated React Flow graph.

## Architecture

<div align="center">

### 🧭 Step 1 — Distribution

![Distributor](https://img.shields.io/badge/🧭_Distributor-Domain_Selector-4A90D9?style=for-the-badge)

*Routes the input to the most relevant expert domains*

---

### 🧠 Step 2 — Expert Analysis (Parallel)

| ![Legal](https://img.shields.io/badge/⚖️_Expert_1-Legal-7B68EE?style=for-the-badge) | ![Finance](https://img.shields.io/badge/💹_Expert_2-Finance-2ECC71?style=for-the-badge) | ![Medical](https://img.shields.io/badge/🩺_Expert_N-Medical-E74C3C?style=for-the-badge) |
|:---:|:---:|:---:|
| Analyzes legal risk & compliance | Evaluates financial implications | Assesses health & safety factors |

*Each expert analyzes from their domain's lens — simultaneously*

---

### 🔍 Step 3 — Cross-Check

![CrossCheck](https://img.shields.io/badge/🔍_Cross--Check_Coordinator-Contradiction_Finder-F39C12?style=for-the-badge)

*Finds conflicts, gaps, and disagreements across expert outputs*

---

### ✅ Step 4 — Synthesis

![Synthesizer](https://img.shields.io/badge/✅_Chief_Synthesizer-Final_Verdict-1ABC9C?style=for-the-badge)

*Produces a unified, actionable conclusion*

</div>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM Provider | HuggingFace Inference API |
| LLM Wrapper | langchain-huggingface (HuggingFaceEndpoint) |
| Orchestration | LangGraph |
| Backend | FastAPI + uvicorn |
| WebSockets | FastAPI WebSocket + asyncio |
| Database | PostgreSQL (async via asyncpg) |
| ORM | SQLAlchemy 2.0 async |
| Cache | Redis |
| Search | FAISS (local vector store) |
| Auth | JWT + bcrypt |
| Frontend | React + Vite + TypeScript |
| Graph UI | React Flow |
| Animation | Framer Motion |
| State | Zustand |
| Styling | Tailwind CSS |
| Container | Docker + Docker Compose |

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (for PostgreSQL + Redis)
- HuggingFace API token ([get one free](https://huggingface.co/settings/tokens))

## Quick Start

```bash
# Clone and enter
git clone https://github.com/MKarthik730/cognitus.git
cd cognitus

# Backend setup
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r backend/requirements.txt

# Frontend setup
cd frontend
npm install
cd ..

# Environment
cp .env.example .env
# Edit .env with your HF_API_TOKEN

# Start infrastructure
docker compose up -d postgres redis

# Run backend
uvicorn backend.main:app --reload --port 8000

# Run frontend (in a new terminal)
cd frontend && npm run dev
```

## Project Structure

```
cognitus/
├── backend/
│   ├── app/
│   │   ├── agents/         # LLM-powered agent nodes
│   │   ├── graph/          # LangGraph state machine
│   │   ├── api/            # FastAPI routes + WebSocket
│   │   ├── core/           # Config, DB, security
│   │   ├── services/       # HF API, rate limiter, cache, retrieval
│   │   ├── models/         # SQLAlchemy ORM models
│   │   └── schemas/        # Pydantic schemas
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── stores/         # Zustand stores
│   │   └── hooks/          # Custom hooks
│   └── package.json
├── postgres/
│   └── init.sql
├── docker-compose.yml
└── .env.example
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
| WS | `/ws/{situation_id}` | Real-time streaming |
| GET | `/api/nodes` | List expert domains |
| POST | `/api/nodes/custom` | Create custom expert |

## Rate Limits

HuggingFace free tier limits:
- ~1000 requests/day per token
- ~1 req/sec burst rate
- Cortex Council enforces: 800 requests/day global, 50/hour per user

## License

MIT
