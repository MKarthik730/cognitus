# Cortex Council — Development Log

## Last Session: 2026-05-09

### Completed
- **Commit 01** — pushed to `https://github.com/MKarthik730/cognitus.git` (main branch)
  - Message: `chore: initialize project structure and base configuration`
  - Files: folder structure, `.gitignore`, `.env.example`, `README.md`

### Repository
- Remote: `https://github.com/MKarthik730/cognitus.git`
- Branch: `main` (commit 01 done here)

### Remaining Commits (02–20)

| # | Message | Files |
|---|---------|-------|
| 02 | `feat(state): define CouncilState TypedDict and all sub-response types` | `backend/app/graph/state.py` |
| 03 | `feat(db): add SQLAlchemy async models and PostgreSQL init schema` | `backend/app/models/*.py`, `postgres/init.sql` |
| 04 | `feat(core): add config, database session, and JWT security module` | `backend/app/core/config.py`, `database.py`, `security.py` |
| 05 | `feat(auth): implement register and login endpoints with bcrypt` | `backend/app/api/routes/auth.py`, `schemas/auth.py` |
| 06 | `feat(services): build HFService — HuggingFaceEndpoint wrapper with Mistral/Zephyr/Phi3 fallback` | `backend/app/services/hf_service.py` |
| 07 | `feat(services): implement rate limiter — token bucket, Redis counters, daily/hourly limits` | `backend/app/services/rate_limiter.py` |
| 08 | `feat(services): Redis cache layer — SHA256 key generation, TTL management` | `backend/app/services/cache.py` |
| 09 | `feat(agents): expert node factory with HF prompt templates` | `backend/app/agents/expert_node.py` |
| 10 | `feat(agents): distributor node — domain selector keeping API calls minimal` | `backend/app/agents/distributor.py` |
| 11 | `feat(agents): cross-check coordinator — batched contradiction detection` | `backend/app/agents/crosscheck.py` |
| 12 | `feat(agents): chief synthesizer with structured output parsing` | `backend/app/agents/synthesizer.py` |
| 13 | `feat(graph): wire full LangGraph council graph — parallel expert execution` | `backend/app/graph/council_graph.py` |
| 14 | `feat(api): sessions CRUD + analyze endpoint with rate limit enforcement` | `backend/app/api/routes/sessions.py`, `analyze.py`, schemas |
| 15 | `feat(ws): WebSocket handler — streaming all graph events` | `backend/app/api/websocket.py`, `services/queue_worker.py` |
| 16 | `feat(main): wire FastAPI app, background queue worker, CORS, lifespan` | `backend/main.py`, `requirements.txt`, `Dockerfile` |
| 17 | `feat(store): Zustand store + WebSocket hook handling all event types` | `frontend/src/stores/councilStore.ts`, `hooks/useCouncilSocket.ts` |
| 18 | `feat(graph-ui): React Flow canvas — animated nodes, consensus/conflict edges` | `frontend/src/components/Graph/*.tsx` |
| 19 | `feat(ui): QueryBar, RateLimitBanner, ConsensusMeter, SynthesisPanel` | `frontend/src/components/*.tsx` |
| 20 | `chore: docker-compose, final README with architecture diagram and API docs` | `docker-compose.yml`, final `README.md` |

### Branch Strategy (to execute at appropriate commits)
```
main → feature/core-infra (commits 02-05) → dev
dev → feature/hf-service (commits 06-08) → dev
dev → feature/agents (commits 09-12) → dev
dev → feature/langgraph (commit 13) → dev
dev → feature/api-websocket (commits 14-16) → dev
dev → feature/frontend (commits 17-19) → dev
dev → main (commit 20)
```

### Spec Details
- **LLM Provider**: HuggingFace Inference API (Mistral-7B-Instruct-v0.3 primary, Zephyr-7b-beta fallback, Phi-3-mini fallback)
- **Rate Limits**: 800/day global, 50/hour per user, 1 req/2sec burst
- **Retry**: tenacity with exponential backoff (2s, 4s, 8s)
- **Cache**: SHA256(model+prompt) key, 24h TTL in Redis
- **DB**: 7 tables including `api_usage_log`
- **Prompt Format**: `[INST]` tags for Mistral, `<|system|>` for Zephyr
- **Total HF calls per analysis**: 6-8 (1 distributor + 3-5 experts + 1 crosscheck + 1 synthesizer)

### Next Steps
To resume, tell me the commit number to build next.
