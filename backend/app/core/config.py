from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # LLM Router — 4-mode system
    # ------------------------------------------------------------------
    LLM_MODE: str = "free"  # free | local | paid | browser

    # Mode 1: Free (Groq)
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # Mode 1: Free (Google fallback)
    GOOGLE_API_KEY: str = ""

    # Mode 2: Local (Ollama)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = ""  # empty = auto-detect

    # Mode 3: Paid (BYOK)
    PAID_PROVIDER: str = "openai"  # openai | anthropic
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-3-5-sonnet-20241022"

    # Legacy HuggingFace (for backward compat / image analysis)
    HF_API_TOKEN: str = ""
    HF_PRIMARY_MODEL: str = "meta-llama/Llama-3.2-1B-Instruct"
    HF_FALLBACK_1: str = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
    HF_FALLBACK_2: str = "katanemo/Arch-Router-1.5B"

    # Token limits
    HF_DEFAULT_MAX_TOKENS: int = 512
    HF_EXPERT_MAX_TOKENS: int = 512
    HF_SYNTHESIS_MAX_TOKENS: int = 2048
    HF_NODE_SELECTOR_MAX_TOKENS: int = 1024
    HF_TIMEOUT: int = 60
    HF_DAILY_LIMIT: int = 800
    HF_HOURLY_LIMIT: int = 50

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/cortex"
    REDIS_URL: str = "redis://redis:6379"

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------
    SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ------------------------------------------------------------------
    # Ghost Mode
    # ------------------------------------------------------------------
    GHOST_MODE: str = "off"  # off | fog | shadow | void | phantom
    GHOST_RATE_LIMIT_BURST: int = 5
    GHOST_RATE_LIMIT_HOURLY: int = 20

    # ------------------------------------------------------------------
    # FAISS / Vector
    # ------------------------------------------------------------------
    FAISS_INDEX_PATH: str = "./data/faiss"

    # ------------------------------------------------------------------
    # Enrichment
    # ------------------------------------------------------------------
    TAVILY_API_KEY: str = ""
    ENRICHMENT_ENABLED: bool = True

    # ------------------------------------------------------------------
    # Eval Harness
    # ------------------------------------------------------------------
    ADMIN_SECRET: str = ""

    # ------------------------------------------------------------------
    # Onboarding
    # ------------------------------------------------------------------
    ONBOARDING_COMPLETE: bool = False


settings = Settings()
