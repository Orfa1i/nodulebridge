"""LLM extraction through the Anthropic Messages API.

The model reads numbered sentences and returns one `record_extraction` tool call whose input
matches shared/schemas/extraction-result.schema.json. It extracts only; verification and every
computed field (mean diameter, confidence) are deterministic code in verify_extraction.py.

Notes on the current API (claude-sonnet-5-5): forced tool_choice (`any`/`tool`) and non-default
sampling parameters return a 400, so the tool is offered with tool_choice auto + strict schema and
the prompt tells the model to call it; temperature is not sent. Stability comes from the cache and
from verification, not from sampling settings.
"""

from __future__ import annotations

import copy
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import anthropic
from jsonschema import Draft202012Validator

from app.config import ROOT, Settings

from .report_text import Sentence

log = logging.getLogger("nodulebridge.extractor")

PROMPT_VERSION = "extract_v1"
PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / f"{PROMPT_VERSION}.md"
SCHEMA_DIR = ROOT / "shared" / "schemas"
TOOL_NAME = "record_extraction"
MAX_TOKENS = 8000
ATTEMPTS = 3
EFFORT_MODEL_PREFIXES = (
    "claude-fable", "claude-mythos", "claude-opus-5", "claude-sonnet-5", "claude-haiku-5",
    "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6",
)  # fmt: skip


class ExtractionUnavailable(Exception):
    """The AI layer is not configured (for example no API key). Message is user-safe."""


class ExtractionFailed(Exception):
    """The model call failed. `detail` carries the provider message in plain English."""

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.detail = detail


@dataclass
class LlmOutput:
    result: dict
    model: str
    request_id: str | None = None
    usage: dict | None = None


class Extractor(Protocol):
    model: str

    def extract(self, sentences: list[Sentence], deadline: float) -> LlmOutput: ...


# ----- tool schema -----


def _strip_read_only(node: Any) -> Any:
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            node = dict(node)
            node["properties"] = {k: v for k, v in props.items() if not (isinstance(v, dict) and v.get("readOnly"))}
            if "required" in node:
                node["required"] = [r for r in node["required"] if r in node["properties"]]
        return {k: _strip_read_only(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_strip_read_only(v) for v in node]
    return node


def _inline_refs(node: Any, schema_dir: Path) -> Any:
    if isinstance(node, dict):
        if "$ref" in node and isinstance(node["$ref"], str) and node["$ref"].endswith(".schema.json"):
            target = json.loads((schema_dir / node["$ref"]).read_text(encoding="utf-8"))
            return _inline_refs(target, schema_dir)
        return {k: _inline_refs(v, schema_dir) for k, v in node.items()}
    if isinstance(node, list):
        return [_inline_refs(v, schema_dir) for v in node]
    return node


def tool_input_schema(schema_dir: Path = SCHEMA_DIR) -> dict:
    """The extraction schema with refs inlined and computed (readOnly) fields removed."""
    schema = json.loads((schema_dir / "extraction-result.schema.json").read_text(encoding="utf-8"))
    schema = _strip_read_only(_inline_refs(schema, schema_dir))

    def clean(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: clean(v) for k, v in node.items() if k not in {"$schema", "$id", "title"}}
        if isinstance(node, list):
            return [clean(v) for v in node]
        return node

    return clean(schema)


def build_user_message(sentences: list[Sentence]) -> str:
    body = "\n".join(f"[{s.id}] {s.text}" for s in sentences)
    return (
        "<report_sentences>\n"
        f"{body}\n"
        "</report_sentences>\n\n"
        f"Call the tool `{TOOL_NAME}` once with the extraction. Do not write any other answer."
    )


def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


# ----- logging -----


def _log_exchange(settings: Settings, record: dict) -> None:
    try:
        folder = settings.data_dir / "logs" / "llm"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{datetime.now(UTC):%Y-%m-%d}.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:  # logging must never break extraction
        log.warning("could not write LLM log: %s", exc)


def _plain_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.AuthenticationError):
        return f"The Anthropic API rejected the key (401): {exc.message}"
    if isinstance(exc, anthropic.PermissionDeniedError):
        return f"The Anthropic API key lacks permission (403): {exc.message}"
    if isinstance(exc, anthropic.NotFoundError):
        return f"The model was not found (404). Check ANTHROPIC_MODEL: {exc.message}"
    if isinstance(exc, anthropic.RateLimitError):
        return f"The Anthropic API is rate limiting requests (429): {exc.message}"
    if isinstance(exc, anthropic.BadRequestError):
        return f"The Anthropic API rejected the request (400): {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        return f"The Anthropic API returned an error ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APITimeoutError):
        return "The Anthropic API did not answer in time."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API (network error)."
    return str(exc)


class AnthropicExtractor:
    def __init__(self, settings: Settings):
        if not settings.anthropic_api_key:
            raise ExtractionUnavailable(
                "The AI service is not configured: ANTHROPIC_API_KEY is not set in the environment."
            )
        if not settings.anthropic_model:
            raise ExtractionUnavailable(
                "The AI service is not configured: ANTHROPIC_MODEL is not set in the environment."
            )
        self.settings = settings
        self.model = settings.anthropic_model
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=0)
        self.tool_schema = tool_input_schema()
        self._validator = Draft202012Validator(self.tool_schema)
        self._system = system_prompt()

    def _request(self, user_message: str, strict: bool) -> dict:
        tool = {
            "name": TOOL_NAME,
            "description": "Record the facts extracted from the radiology report.",
            "input_schema": copy.deepcopy(self.tool_schema),
        }
        if strict:
            tool["strict"] = True
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": self._system,
            "tools": [tool],
            "tool_choice": {"type": "auto"},
            "messages": [{"role": "user", "content": user_message}],
        }
        if self.model.startswith(EFFORT_MODEL_PREFIXES):
            params["output_config"] = {"effort": "medium"}
        return params

    def extract(self, sentences: list[Sentence], deadline: float) -> LlmOutput:
        user_message = build_user_message(sentences)
        strict = True
        last_error = "The model did not return an extraction."
        for attempt in range(1, ATTEMPTS + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 1.0:
                raise ExtractionFailed("The report could not be read in time.", "The 20 second limit was reached.")
            params = self._request(user_message, strict)
            record: dict[str, Any] = {
                "ts": datetime.now(UTC).isoformat(),
                "prompt_version": PROMPT_VERSION,
                "attempt": attempt,
                "request": {k: v for k, v in params.items() if k != "tools"}
                | {"tool_name": TOOL_NAME, "strict": strict},
            }
            try:
                response = self.client.with_options(timeout=remaining).messages.create(**params)
            except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as exc:
                record["error"] = _plain_error(exc)
                _log_exchange(self.settings, record)
                raise ExtractionFailed("The report could not be read.", _plain_error(exc)) from exc
            except anthropic.BadRequestError as exc:
                record["error"] = _plain_error(exc)
                _log_exchange(self.settings, record)
                if strict and any(w in exc.message.lower() for w in ("schema", "strict")):
                    log.warning("strict tool schema rejected, retrying without strict: %s", exc.message)
                    strict = False
                    last_error = _plain_error(exc)
                    continue
                raise ExtractionFailed("The report could not be read.", _plain_error(exc)) from exc
            except (anthropic.RateLimitError, anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
                record["error"] = _plain_error(exc)
                _log_exchange(self.settings, record)
                last_error = _plain_error(exc)
                if isinstance(exc, anthropic.APIStatusError) and exc.status_code < 500 and exc.status_code != 429:
                    raise ExtractionFailed("The report could not be read.", last_error) from exc
                time.sleep(min(0.5 * 2 ** (attempt - 1), max(deadline - time.monotonic() - 1.0, 0)))
                continue

            record["response"] = {
                "id": response.id,
                "model": response.model,
                "stop_reason": response.stop_reason,
                "usage": response.usage.model_dump() if response.usage else None,
                "content": [b.model_dump() for b in response.content],
            }
            _log_exchange(self.settings, record)

            if response.stop_reason == "refusal":
                raise ExtractionFailed(
                    "The report could not be read.", "The model declined to process this text (stop reason: refusal)."
                )
            tool_use = next((b for b in response.content if b.type == "tool_use" and b.name == TOOL_NAME), None)
            if tool_use is None:
                last_error = f"The model answered without calling the tool (stop reason: {response.stop_reason})."
                continue
            errors = sorted(self._validator.iter_errors(tool_use.input), key=lambda e: list(e.path))
            if errors:
                last_error = "The model output did not match the schema: " + errors[0].message
                continue
            return LlmOutput(
                result=tool_use.input,
                model=response.model,
                request_id=getattr(response, "_request_id", None),
                usage=record["response"]["usage"],
            )
        raise ExtractionFailed("The report could not be read.", last_error)
