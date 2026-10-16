from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    # Second provider: Google AI Studio (Gemini). Used when no Anthropic key is set, or LLM_PROVIDER=gemini.
    google_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_thinking_budget: int | None = None  # None = model default; 0 turns thinking off (faster, may be less accurate)
    llm_provider: str | None = None  # "anthropic" | "gemini"; default picks whichever key is set
    tts_provider: str | None = None
    tts_api_key: str | None = None
    tts_voice_ar: str | None = None
    tts_voice_en: str | None = None
    web_origin: str = "http://localhost:3000"
    data_base_url: str | None = None
    data_dir: Path = ROOT / "data"
    extract_timeout_s: float = 20.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
