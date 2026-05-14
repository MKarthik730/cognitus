from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    HF_API_TOKEN: str
    HF_PRIMARY_MODEL: str = "meta-llama/Llama-3.2-1B-Instruct"
    HF_FALLBACK_1: str = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
    HF_FALLBACK_2: str = "katanemo/Arch-Router-1.5B"
    HF_DEFAULT_MAX_TOKENS: int = 512
    HF_EXPERT_MAX_TOKENS: int = 512
    HF_SYNTHESIS_MAX_TOKENS: int = 2048
    HF_NODE_SELECTOR_MAX_TOKENS: int = 1024
    HF_TIMEOUT: int = 60
    HF_DAILY_LIMIT: int = 800
    HF_HOURLY_LIMIT: int = 50

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/cortex"
    REDIS_URL: str = "redis://localhost:6379"

    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    FAISS_INDEX_PATH: str = "./data/faiss"


settings = Settings()
