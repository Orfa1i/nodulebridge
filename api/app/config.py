from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    tts_provider: str | None = None
    tts_api_key: str | None = None
    tts_voice_ar: str | None = None
    tts_voice_en: str | None = None
    web_origin: str = "http://localhost:3000"
    data_base_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
