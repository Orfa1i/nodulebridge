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
    app.dependency_overrides[get_settings] = lambda: Settings(anthropic_model="test-model")
    try:
        assert client.get("/health").json()["model"] == "test-model"
    finally:
        app.dependency_overrides.clear()


def test_cors_allows_web_origin():
    r = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
