import base64
import io
import json
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.routers import explain as explain_router
from app.services.tts import (
    GeminiTts,
    TtsFailed,
    TtsUnavailable,
    audio_duration,
    resolve_tts_provider,
)


def pcm(seconds):
    return b"\x01\x00" * int(24000 * seconds)


def wav(seconds):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnframes(0)
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm(seconds))
    return buf.getvalue()


def settings(tmp_path, **kw):
    return Settings(_env_file=None, google_api_key="test-key", tts_api_key=None, data_dir=tmp_path, **kw)


def transport(handler):
    return httpx.MockTransport(handler)


def audio_response(data, mime):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}]}}]})


def test_duration_from_raw_pcm_and_wav():
    assert audio_duration(pcm(2.5), "audio/L16;rate=24000") == 2.5
    assert audio_duration(wav(3), "audio/wav") == 3.0


def test_synthesize_caches_by_text_and_never_logs_the_key(tmp_path):
    calls = []

    def handler(req):
        calls.append(req)
        assert req.headers["x-goog-api-key"] == "test-key"
        assert "test-key" not in str(req.url)
        return audio_response(pcm(2), "audio/L16;rate=24000")

    tts = GeminiTts(settings(tmp_path), transport=transport(handler), encoder=lambda data, mime: b"MP3" + data[:4])
    first = tts.synthesize("Hello there.", "en")
    second = tts.synthesize("Hello there.", "en")
    assert len(calls) == 1 and not first.cached and second.cached
    assert first.duration_s == 2.0 and first.text_sha256 == second.text_sha256


def test_retries_then_reports_a_plain_error(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.tts.time.sleep", lambda s: None)
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        return httpx.Response(503, json={"error": {"message": "overloaded"}})

    tts = GeminiTts(settings(tmp_path), transport=transport(handler), encoder=lambda d, m: b"x")
    with pytest.raises(TtsFailed) as exc:
        tts.synthesize("Hello", "en")
    assert n["c"] == 3 and "overloaded" in (exc.value.detail or "")


def test_long_daily_quota_is_not_waited_for(tmp_path, monkeypatch):
    slept = []
    monkeypatch.setattr("app.services.tts.time.sleep", lambda s: slept.append(s))
    body = {"error": {"message": "Quota exceeded. Please retry in 11h52m39.6s."}}
    tts = GeminiTts(settings(tmp_path), transport=transport(lambda r: httpx.Response(429, json=body)), encoder=lambda d, m: b"x")
    with pytest.raises(TtsFailed):
        tts.synthesize("Hello", "en")
    assert slept == [] or max(slept) < 70


def test_empty_text_and_missing_key_are_refused(tmp_path):
    tts = GeminiTts(settings(tmp_path), transport=transport(lambda r: httpx.Response(500)), encoder=lambda d, m: b"x")
    with pytest.raises(TtsFailed):
        tts.synthesize("   ", "en")
    with pytest.raises(TtsUnavailable):
        GeminiTts(Settings(_env_file=None, google_api_key=None, tts_api_key=None, data_dir=tmp_path))


def test_provider_resolution(tmp_path):
    assert resolve_tts_provider(Settings(_env_file=None, google_api_key=None, tts_api_key=None, tts_provider=None, data_dir=tmp_path)) is None
    assert resolve_tts_provider(settings(tmp_path)) == "gemini"
    with pytest.raises(TtsUnavailable):
        resolve_tts_provider(Settings(_env_file=None, tts_provider="espeak", data_dir=tmp_path))


def test_tts_endpoint_reports_unavailable_in_plain_words(monkeypatch):
    def boom():
        raise TtsUnavailable("Speech is not configured: set GOOGLE_API_KEY.")

    monkeypatch.setattr(explain_router, "get_tts", boom)
    r = TestClient(app).post("/tts", json={"text": "Hello", "locale": "en"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "speech_unavailable" and "GOOGLE_API_KEY" in r.json()["error"]["detail"]


def test_tts_endpoint_returns_mp3_with_duration_header(monkeypatch):
    class Fake:
        def synthesize(self, text, locale):
            from app.services.tts import Audio

            return Audio(b"ID3fake", 4.2, "gemini", "m", "Kore", locale, "abc")

    monkeypatch.setattr(explain_router, "get_tts", lambda: Fake())
    r = TestClient(app).post("/tts", json={"text": "Hello", "locale": "ar"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.headers["x-audio-duration"] == "4.2" and r.content == b"ID3fake"
    assert json.loads(json.dumps({"ok": True}))["ok"]
