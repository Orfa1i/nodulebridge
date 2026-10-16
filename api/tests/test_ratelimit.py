import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.routers import explain as explain_router
from app.routers import passport as passport_router
from app.services.extract_service import ExtractService
from app.services.ratelimit import RateLimiter, client_ip, is_local, reset_limiters
from tests.test_extract_endpoint import TEXT, FakeExtractor, llm_result


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_window_slides_and_reports_when_a_slot_frees_up():
    clock = Clock()
    rl = RateLimiter(2, window_s=100, clock=clock)
    assert rl.hit("a") == (True, 0) and rl.hit("a") == (True, 0)
    allowed, retry = rl.hit("a")
    assert allowed is False and 99 <= retry <= 101
    assert rl.hit("b") == (True, 0)  # another address has its own count
    clock.t += 101
    assert rl.hit("a") == (True, 0)


def test_limit_zero_means_unlimited():
    rl = RateLimiter(0)
    assert all(rl.hit("a")[0] for _ in range(50))


def test_client_ip_only_trusts_the_proxy_header_when_told_to():
    class Req:
        def __init__(self, forwarded):
            self.headers = {"x-forwarded-for": forwarded}
            self.client = type("C", (), {"host": "10.0.0.1"})()

    assert client_ip(Req("203.0.113.9, 10.0.0.1"), trust_proxy=False) == "10.0.0.1"
    assert client_ip(Req("203.0.113.9, 10.0.0.1"), trust_proxy=True) == "203.0.113.9"
    assert client_ip(Req("not-an-ip"), trust_proxy=True) == "10.0.0.1"


def test_localhost_is_never_limited():
    assert is_local("127.0.0.1") and is_local("::1") and is_local("localhost")
    assert not is_local("203.0.113.9")


@pytest.fixture
def api(tmp_path):
    reset_limiters()
    settings = Settings(_env_file=None, data_dir=tmp_path, anthropic_model="fake-model", rate_limit_extract_per_hour=2, rate_limit_tts_per_hour=1, rate_limit_pdf_per_hour=1, trust_proxy=True)
    fake = FakeExtractor()
    service = ExtractService(settings, lambda: fake)
    app.dependency_overrides[get_settings] = lambda: settings
    import app.routers.extract as router

    original = router.get_service
    router.get_service = lambda: service
    router.get_settings = lambda: settings
    explain_router.get_settings = lambda: settings
    passport_router.get_settings = lambda: settings
    client = TestClient(app)
    client.fake = fake
    yield client
    router.get_service = original
    router.get_settings = get_settings
    explain_router.get_settings = get_settings
    passport_router.get_settings = get_settings
    app.dependency_overrides.clear()
    reset_limiters()


def post(client, text, ip="203.0.113.7"):
    return client.post("/extract", json={"text": text}, headers={"x-forwarded-for": ip})


def test_extract_stops_the_third_new_report_from_one_address_with_a_plain_message(api):
    api.fake.result = llm_result()
    assert post(api, TEXT + "one").status_code == 200
    assert post(api, TEXT + "two").status_code == 200
    r = post(api, TEXT + "three")
    assert r.status_code == 429
    assert r.json()["error"]["message"] == "Too many requests from this address. Please try again later."
    assert r.json()["error"]["code"] == "rate_limited" and int(r.headers["retry-after"]) > 0
    assert api.fake.calls == 2  # the third request never reached the model
    assert post(api, TEXT + "three", ip="198.51.100.4").status_code == 200  # another address is fine


def test_cached_reports_cost_nothing_and_are_never_limited(api):
    api.fake.result = llm_result()
    assert post(api, TEXT).status_code == 200  # one model call
    for _ in range(10):
        assert post(api, TEXT).status_code == 200  # cache hits
    assert api.fake.calls == 1


def test_localhost_is_not_limited_even_with_a_tiny_limit(api):
    api.fake.result = llm_result()
    for i in range(5):
        assert post(api, TEXT + str(i), ip="127.0.0.1").status_code == 200


def test_tts_and_pdf_have_their_own_limits(api):
    body = {"text": "Hello", "locale": "en"}
    first = api.post("/tts", json=body, headers={"x-forwarded-for": "203.0.113.8"})
    second = api.post("/tts", json=body, headers={"x-forwarded-for": "203.0.113.8"})
    assert first.status_code != 429 and second.status_code == 429
    from tests.test_passport import make_payload

    passport = make_payload()
    one = api.post("/passport/pdf", json={"passport": passport}, headers={"x-forwarded-for": "203.0.113.8"})
    two = api.post("/passport/pdf", json={"passport": passport}, headers={"x-forwarded-for": "203.0.113.8"})
    assert one.status_code != 429 and two.status_code == 429
