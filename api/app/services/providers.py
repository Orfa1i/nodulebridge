"""Pick the LLM provider from the environment: Anthropic when its key is set, otherwise Gemini."""

from __future__ import annotations

from app.config import Settings

from .extractor import AnthropicExtractor, ExtractionUnavailable, Extractor
from .gemini_extractor import GeminiExtractor

PROVIDERS = ("anthropic", "gemini")


def resolve_provider(settings: Settings) -> str | None:
    if settings.llm_provider:
        if settings.llm_provider not in PROVIDERS:
            raise ExtractionUnavailable(f"LLM_PROVIDER must be one of {', '.join(PROVIDERS)} (got {settings.llm_provider!r}).")
        return settings.llm_provider
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.google_api_key:
        return "gemini"
    return None


def model_id(settings: Settings) -> str:
    """Provider-qualified model id used in the cache key and shown in the UI."""
    try:
        provider = resolve_provider(settings)
    except ExtractionUnavailable:
        provider = None
    if provider == "anthropic":
        return f"anthropic:{settings.anthropic_model or 'unset'}"
    if provider == "gemini":
        return f"gemini:{settings.gemini_model}"
    return settings.anthropic_model or "unset"


def make_extractor(settings: Settings) -> Extractor:
    provider = resolve_provider(settings)
    if provider == "anthropic":
        return AnthropicExtractor(settings)
    if provider == "gemini":
        return GeminiExtractor(settings)
    raise ExtractionUnavailable(
        "The AI service is not configured: set ANTHROPIC_API_KEY (and ANTHROPIC_MODEL) or GOOGLE_API_KEY in the environment."
    )
