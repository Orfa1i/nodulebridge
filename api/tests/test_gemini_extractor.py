"""Gemini extractor and provider selection, against a mocked HTTP transport (no network, no key)."""

import json
import time

import httpx
import pytest

from app.config import Settings
from app.services.extract_service import ExtractService
from app.services.extractor import ExtractionFailed, ExtractionUnavailable, system_prompt
from app.services.gemini_extractor import (
    JSON_SENTENCE,
    TOOL_SENTENCE,
    GeminiExtractor,
    gemini_system_prompt,
    gemini_user_message,
)
from app.services.providers import make_extractor, model_id, resolve_provider
from app.services.report_text import read_text

KEY = "AQ.test-key-should-never-appear-in-logs"
TEXT = "No pleural effusion.\nHowever, a 9 mm solid nodule is seen in the right upper lobe.\n"
REPORT = read_text(TEXT)


def result(quote="a 9 mm solid nodule is seen in the right upper lobe"):
    return {
        "study": {"exam_type": None, "indication_text": None, "is_screening_exam": None, "study_date": None},
        "patient_context": {
            k: {"value": None, "evidence_sentence_ids": []} for k in ("age_years", "known_cancer", "immunocompromised", "smoking_history")
        },
        "nodules": [
            {
                "id": "n1", "count_context": "single", "size_text": "9 mm", "dimensions_mm": [9], "size_basis": "stated_single",
                "attenuation": "solid", "solid_component_mm": None, "side": "right", "lobe": "upper", "morphology": [],
                "benign_features": [], "stability_text": None, "assertion": "present",
                "evidence": [{"sentence_id": "s002", "quote": quote}],
            }
        ],
        "other_findings": [],
    }  # fmt: skip


def ok(payload=None, finish="STOP", thought=None):
    parts = [{"text": json.dumps(payload or result())}]
    if thought:
        parts.insert(0, {"text": thought, "thought": True})
    return httpx.Response(200, json={"candidates": [{"content": {"parts": parts}, "finishReason": finish}], "modelVersion": "gemini-2.5-flash", "responseId": "r1", "usageMetadata": {"totalTokenCount": 10}})


def extractor(tmp_path, handler, **kw):
    settings = Settings(data_dir=tmp_path, google_api_key=KEY, anthropic_api_key=None, **kw)
    return GeminiExtractor(settings, transport=httpx.MockTransport(handler))


def run(ex, seconds=20):
    return ex.extract(REPORT.sentences, time.monotonic() + seconds)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _s: None)


def test_success_and_request_shape(tmp_path):
    seen = {}

    def handler(request):
        seen["url"], seen["headers"], seen["body"] = str(request.url), request.headers, json.loads(request.content)
        return ok(thought="reasoning that must be ignored")

    out = run(extractor(tmp_path, handler))
    assert out.result["nodules"][0]["dimensions_mm"] == [9]
    assert out.model == "gemini:gemini-2.5-flash" and out.request_id == "r1" and out.usage == {"totalTokenCount": 10}
    assert seen["url"].endswith("/models/gemini-2.5-flash:generateContent") and KEY not in seen["url"]
    assert seen["headers"]["x-goog-api-key"] == KEY
    body = seen["body"]
    assert KEY not in json.dumps(body)
    cfg = body["generationConfig"]
    assert cfg["responseMimeType"] == "application/json" and cfg["temperature"] == 0 and "thinkingConfig" not in cfg
    assert cfg["responseJsonSchema"]["properties"]["nodules"]["items"]["properties"]["assertion"]
    assert "mean_diameter_mm" not in cfg["responseJsonSchema"]["properties"]["nodules"]["items"]["properties"]
    text = body["contents"][0]["parts"][0]["text"]
    assert text.startswith("<report_sentences>") and "[s002] However, a 9 mm solid nodule" in text
    assert "Call the tool" not in text and JSON_SENTENCE in body["systemInstruction"]["parts"][0]["text"]


def test_prompt_adaptation_replaces_only_the_output_instruction():
    assert TOOL_SENTENCE in system_prompt() and TOOL_SENTENCE not in gemini_system_prompt()
    assert gemini_system_prompt().replace(JSON_SENTENCE, TOOL_SENTENCE) == system_prompt()
    assert "Call the tool" not in gemini_user_message(REPORT.sentences)


def test_thinking_budget_is_sent_when_configured(tmp_path):
    seen = {}

    def handler(request):
        seen["cfg"] = json.loads(request.content)["generationConfig"]
        return ok()

    run(extractor(tmp_path, handler, gemini_thinking_budget=0))
    assert seen["cfg"]["thinkingConfig"] == {"thinkingBudget": 0}


def test_transient_errors_are_retried_then_succeed(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": {"message": "high demand"}})
        if len(calls) == 2:
            raise httpx.ConnectError("boom")
        return ok()

    assert run(extractor(tmp_path, handler)).result["nodules"]
    assert len(calls) == 3


def test_three_failures_surface_the_provider_message(tmp_path):
    def handler(request):
        return httpx.Response(503, json={"error": {"message": "This model is currently experiencing high demand."}})

    with pytest.raises(ExtractionFailed) as err:
        run(extractor(tmp_path, handler))
    assert "503" in err.value.detail and "high demand" in err.value.detail


@pytest.mark.parametrize(
    ("status", "text"),
    [(400, "rejected the request (400)"), (401, "rejected the key (401)"), (403, "rejected the key (403)"), (404, "Check GEMINI_MODEL")],
)
def test_client_errors_fail_at_once_with_a_plain_message(tmp_path, status, text):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(status, json={"error": {"message": "API key not valid"}})

    with pytest.raises(ExtractionFailed) as err:
        run(extractor(tmp_path, handler))
    assert text in err.value.detail and "API key not valid" in err.value.detail
    assert len(calls) == 1


def test_invalid_json_and_schema_violations_are_retried(tmp_path):
    answers = iter([
        httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json"}]}, "finishReason": "STOP"}]}),
        ok({"study": {}}),  # valid JSON, wrong shape
        ok(),
    ])  # fmt: skip
    assert run(extractor(tmp_path, lambda r: next(answers))).result["nodules"]
    bad = ok({"study": {}})
    with pytest.raises(ExtractionFailed) as err:
        run(extractor(tmp_path, lambda r: bad))
    assert "did not match the schema" in err.value.detail


def test_blocked_prompt_and_early_stop(tmp_path):
    blocked = httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})
    with pytest.raises(ExtractionFailed, match="could not be read") as err:
        run(extractor(tmp_path, lambda r: blocked))
    assert "SAFETY" in err.value.detail
    cut = ok(finish="MAX_TOKENS")
    with pytest.raises(ExtractionFailed) as err:
        run(extractor(tmp_path, lambda r: cut))
    assert "MAX_TOKENS" in err.value.detail


def test_deadline_is_respected(tmp_path):
    calls = []
    with pytest.raises(ExtractionFailed) as err:
        extractor(tmp_path, lambda r: calls.append(1)).extract(REPORT.sentences, time.monotonic() - 1)
    assert "20 second limit" in err.value.detail and calls == []


def test_request_and_response_are_logged_without_the_key(tmp_path):
    run(extractor(tmp_path, lambda r: ok()))
    logs = list((tmp_path / "logs" / "llm").glob("*.jsonl"))
    assert logs
    content = logs[0].read_text(encoding="utf-8")
    record = json.loads(content.splitlines()[0])
    assert record["provider"] == "gemini" and record["http_status"] == 200 and "[s002]" in record["request"]["user_message"]
    assert record["response"]["candidates"] and KEY not in content


def test_missing_key_message():
    with pytest.raises(ExtractionUnavailable, match="GOOGLE_API_KEY is not set"):
        GeminiExtractor(Settings(google_api_key=None))


def test_through_the_service_with_cache_and_verification(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return ok()

    settings = Settings(data_dir=tmp_path, google_api_key=KEY, anthropic_api_key=None)
    ex = GeminiExtractor(settings, transport=httpx.MockTransport(handler))
    service = ExtractService(settings, lambda: ex)
    first = service.run(REPORT, 1.0)
    second = service.run(REPORT, 1.0)
    assert first["cached"] is False and second["cached"] is True and len(calls) == 1
    assert first["model"] == "gemini:gemini-2.5-flash"
    assert first["result"]["nodules"][0]["confidence"] == "checked"
    # a quote the model got wrong is caught by the same verification used for every provider
    bad = ok(result(quote="a 9 mm solid nodule is seen in the right upper lobx"))
    service2 = ExtractService(Settings(data_dir=tmp_path / "b", google_api_key=KEY, anthropic_api_key=None), lambda: GeminiExtractor(settings, transport=httpx.MockTransport(lambda r: bad)))
    out = service2.run(REPORT, 1.0)
    assert out["result"]["nodules"] == [] and out["verification"]["quotes_dropped"] == 1


# ----- provider selection -----


def settings(**kw):
    base = {"anthropic_api_key": None, "google_api_key": None, "llm_provider": None, "anthropic_model": None}
    return Settings(**(base | kw))


def test_provider_resolution():
    assert resolve_provider(settings()) is None
    assert resolve_provider(settings(google_api_key="g")) == "gemini"
    assert resolve_provider(settings(anthropic_api_key="a", google_api_key="g")) == "anthropic"
    assert resolve_provider(settings(anthropic_api_key="a", google_api_key="g", llm_provider="gemini")) == "gemini"
    with pytest.raises(ExtractionUnavailable, match="LLM_PROVIDER"):
        resolve_provider(settings(llm_provider="openai"))


def test_model_id_is_provider_qualified():
    assert model_id(settings(google_api_key="g")) == "gemini:gemini-2.5-flash"
    assert model_id(settings(google_api_key="g", gemini_model="gemini-3.8-flash")) == "gemini:gemini-3.8-flash"
    assert model_id(settings(anthropic_api_key="a", anthropic_model="claude-sonnet-5-5")) == "anthropic:claude-sonnet-5-5"
    assert model_id(settings(anthropic_model="m")) == "m" and model_id(settings()) == "unset"
    assert model_id(settings(llm_provider="bogus")) == "unset"


def test_make_extractor_picks_the_provider_or_explains():
    assert isinstance(make_extractor(settings(google_api_key="g")), GeminiExtractor)
    with pytest.raises(ExtractionUnavailable, match="ANTHROPIC_API_KEY .* or GOOGLE_API_KEY"):
        make_extractor(settings())
    assert make_extractor(settings(anthropic_api_key="a", anthropic_model="claude-sonnet-5-5")).model == "claude-sonnet-5-5"
