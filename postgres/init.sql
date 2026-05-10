CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    situation TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analyses (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    distributor_output TEXT,
    cross_check_output TEXT,
    synthesis_output TEXT,
    consensus_score FLOAT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expert_responses (
    id SERIAL PRIMARY KEY,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    domain VARCHAR(50) NOT NULL,
    analysis_text TEXT NOT NULL,
    confidence VARCHAR(10) NOT NULL DEFAULT 'medium',
    citations TEXT,
    model_used VARCHAR(100) NOT NULL,
    processing_time_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contradictions (
    id SERIAL PRIMARY KEY,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    domain_a VARCHAR(50) NOT NULL,
    domain_b VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'medium'
);

CREATE TABLE IF NOT EXISTS agreements (
    id SERIAL PRIMARY KEY,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    domain_a VARCHAR(50) NOT NULL,
    domain_b VARCHAR(50) NOT NULL,
    points TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    model_used VARCHAR(100),
    tokens_used INTEGER,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_session_id ON analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_expert_responses_analysis_id ON expert_responses(analysis_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_analysis_id ON contradictions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_agreements_analysis_id ON agreements(analysis_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_user_id ON api_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_created_at ON api_usage_log(created_at);
