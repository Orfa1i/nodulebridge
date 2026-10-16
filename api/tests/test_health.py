from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert "model" in body


def test_health_reports_model_from_env():
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key="k", anthropic_model="test-model", google_api_key=None)
    try:
        body = client.get("/health").json()
        assert body["model"] == "anthropic:test-model" and body["provider"] == "anthropic"
    finally:
        app.dependency_overrides.clear()


def test_cors_allows_web_origin():
    r = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_health_reports_no_provider_when_no_key_is_set():
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key=None, google_api_key=None, anthropic_model=None)
    try:
        body = client.get("/health").json()
        assert body["provider"] is None and body["model"] is None
    finally:
        app.dependency_overrides.clear()


def test_health_reports_gemini_when_only_a_google_key_is_set():
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_api_key=None, google_api_key="g")
    try:
        body = client.get("/health").json()
        assert body["provider"] == "gemini" and body["model"].startswith("gemini:")
    finally:
        app.dependency_overrides.clear()
