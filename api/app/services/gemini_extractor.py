"""Extraction through the Google Gemini API (REST generateContent, JSON output constrained by the schema).

Same contract as the Anthropic extractor: the model only extracts; verification and every computed
field stay deterministic code. The same prompt file and the same extraction schema are used; the
only change is the output instruction (JSON mode instead of a tool call).

Notes: the key is sent in the `x-goog-api-key` header, never in the URL, and never logged.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from jsonschema import Draft202012Validator

from app.config import Settings

from .extractor import (
    TOOL_NAME,
    ExtractionFailed,
    ExtractionUnavailable,
    LlmOutput,
    _log_exchange,
    build_user_message,
    system_prompt,
    tool_input_schema,
)
from .report_text import Sentence

log = logging.getLogger("nodulebridge.gemini")

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
ATTEMPTS = 3
BACKOFF_S = 2.0  # 503 "high demand" spikes last seconds: wait 2 s, then 4 s
MAX_OUTPUT_TOKENS = 8000
RETRYABLE = {429, 500, 502, 503, 504}
TOOL_SENTENCE = f"Call the tool `{TOOL_NAME}` exactly once with the result. Do not answer in prose."
JSON_SENTENCE = "Return exactly one JSON object that matches the response schema. Do not answer in prose."


def gemini_schema(schema: Any) -> Any:
    """Express every `enum` that contains null as anyOf [string enum, null].

    Gemini's constrained decoding drops null from a plain enum, which forces the model to pick one of
    the listed values (a negated nodule then gets a side and lobe, silence about smoking becomes
    "never"). anyOf with an explicit null branch keeps "not stated" available.
    """
    if isinstance(schema, dict):
        if isinstance(schema.get("enum"), list) and None in schema["enum"]:
            members = [e for e in schema["enum"] if e is not None]
            out = {"anyOf": [{"type": "string", "enum": members}, {"type": "null"}]}
            if "description" in schema:
                out["description"] = schema["description"]
            return out
        return {k: gemini_schema(v) for k, v in schema.items()}
    if isinstance(schema, list):
        return [gemini_schema(v) for v in schema]
    return schema


def gemini_system_prompt() -> str:
    prompt = system_prompt()
    if TOOL_SENTENCE not in prompt:  # the prompt file changed: fail loudly instead of sending a wrong instruction
        raise RuntimeError("extract prompt no longer contains the tool-call sentence; update gemini_system_prompt()")
    return prompt.replace(TOOL_SENTENCE, JSON_SENTENCE)


def gemini_user_message(sentences: list[Sentence]) -> str:
    body = build_user_message(sentences)
    tail = f"Call the tool `{TOOL_NAME}` once with the extraction. Do not write any other answer."
    return body.replace(tail, "Return the extraction as one JSON object. Do not write any other answer.")


def _plain_error(status: int, message: str) -> str:
    if status in {401, 403}:
        return f"The Google API rejected the key ({status}): {message}"
    if status == 404:
        return f"The Gemini model was not found (404). Check GEMINI_MODEL: {message}"
    if status == 429:
        return f"The Google API is rate limiting requests (429): {message}"
    if status == 400:
        return f"The Google API rejected the request (400): {message}"
    return f"The Google API returned an error ({status}): {message}"


class GeminiExtractor:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        if not settings.google_api_key:
            raise ExtractionUnavailable("The AI service is not configured: GOOGLE_API_KEY is not set in the environment.")
        self.settings = settings
        self.model = f"gemini:{settings.gemini_model}"
        self._model_name = settings.gemini_model
        self._key = settings.google_api_key
        self._client = httpx.Client(transport=transport)
        self.schema = gemini_schema(tool_input_schema())
        self._validator = Draft202012Validator(self.schema)
        self._system = gemini_system_prompt()

    def _body(self, user_message: str) -> dict[str, Any]:
        config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "responseJsonSchema": self.schema,
            "temperature": 0,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        }
        if self.settings.gemini_thinking_budget is not None:
            config["thinkingConfig"] = {"thinkingBudget": self.settings.gemini_thinking_budget}
        return {
            "systemInstruction": {"parts": [{"text": self._system}]},
            "contents": [{"role": "user", "parts": [{"text": user_message}]}],
            "generationConfig": config,
        }

    def extract(self, sentences: list[Sentence], deadline: float) -> LlmOutput:
        user_message = gemini_user_message(sentences)
        body = self._body(user_message)
        last_error = "The model did not return an extraction."
        for attempt in range(1, ATTEMPTS + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 1.0:
                raise ExtractionFailed("The report could not be read in time.", "The 20 second limit was reached.")
            record: dict[str, Any] = {
                "ts": datetime.now(UTC).isoformat(),
                "provider": "gemini",
                "model": self._model_name,
                "attempt": attempt,
                "request": {"user_message": user_message, "generationConfig": {k: v for k, v in body["generationConfig"].items() if k != "responseJsonSchema"}},
            }
            try:
                resp = self._client.post(
                    ENDPOINT.format(model=self._model_name),
                    headers={"x-goog-api-key": self._key, "content-type": "application/json"},
                    json=body,
                    timeout=remaining,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = "The Google API did not answer in time." if isinstance(exc, httpx.TimeoutException) else "Could not reach the Google API (network error)."
                record["error"] = last_error
                _log_exchange(self.settings, record)
                time.sleep(min(BACKOFF_S * 2 ** (attempt - 1), max(deadline - time.monotonic() - 1.0, 0)))
                continue

            try:
                data = resp.json()
            except ValueError:
                data = {}
            record["http_status"] = resp.status_code
            record["response"] = data
            _log_exchange(self.settings, record)

            if resp.status_code != 200:
                message = (data.get("error") or {}).get("message") or resp.text[:300]
                last_error = _plain_error(resp.status_code, message)
                if resp.status_code in RETRYABLE:
                    time.sleep(min(BACKOFF_S * 2 ** (attempt - 1), max(deadline - time.monotonic() - 1.0, 0)))
                    continue
                raise ExtractionFailed("The report could not be read.", last_error)

            blocked = (data.get("promptFeedback") or {}).get("blockReason")
            candidates = data.get("candidates") or []
            if blocked or not candidates:
                raise ExtractionFailed(
                    "The report could not be read.",
                    f"The model declined to process this text (block reason: {blocked or 'no answer'}).",
                )
            cand = candidates[0]
            reason = cand.get("finishReason")
            if reason not in {None, "STOP"}:
                last_error = f"The model stopped early (finish reason: {reason})."
                continue
            parts = (cand.get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            try:
                result = json.loads(text)
            except ValueError:
                last_error = "The model answer was not valid JSON."
                continue
            errors = sorted(self._validator.iter_errors(result), key=lambda e: list(e.path))
            if errors:
                last_error = "The model output did not match the schema: " + errors[0].message
                continue
            return LlmOutput(
                result=result,
                model=f"gemini:{data.get('modelVersion') or self._model_name}",
                request_id=data.get("responseId"),
                usage=data.get("usageMetadata"),
            )
        raise ExtractionFailed("The report could not be read.", last_error)
