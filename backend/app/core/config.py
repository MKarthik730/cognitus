from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    HF_API_TOKEN: str
    HF_PRIMARY_MODEL: str = "mistralai/Mistral-7B-Instruct-v0.3"
    HF_FALLBACK_1: str = "HuggingFaceH4/zephyr-7b-beta"
    HF_FALLBACK_2: str = "microsoft/Phi-3-mini-4k-instruct"
    HF_MAX_NEW_TOKENS: int = 512
    HF_TIMEOUT: int = 30
    HF_DAILY_LIMIT: int = 800
    HF_HOURLY_LIMIT: int = 50

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/cortex"
    REDIS_URL: str = "redis://localhost:6379"

    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    FAISS_INDEX_PATH: str = "./data/faiss"


settings = Settings()
