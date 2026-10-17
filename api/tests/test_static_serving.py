import importlib

from fastapi.testclient import TestClient


def make_app(monkeypatch, static_dir):
    """A fresh copy of the app configured with STATIC_DIR (main.py reads the setting when it is imported)."""
    from app import config

    monkeypatch.setenv("STATIC_DIR", str(static_dir))
    config.get_settings.cache_clear()
    from app import main

    main = importlib.reload(main)
    return main.app


def test_exported_web_app_is_served_and_the_api_still_wins(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<h1>home</h1>", encoding="utf-8")
    (tmp_path / "passport").mkdir()
    (tmp_path / "passport" / "index.html").write_text("<h1>passport</h1>", encoding="utf-8")
    (tmp_path / "cases" / "case-a").mkdir(parents=True)
    (tmp_path / "cases" / "case-a" / "manifest.json").write_text('{"case_id": "case-a"}', encoding="utf-8")
    try:
        client = TestClient(make_app(monkeypatch, tmp_path))
        assert client.get("/").text == "<h1>home</h1>"
        assert client.get("/passport/").text == "<h1>passport</h1>"
        assert client.get("/cases/case-a/manifest.json").json() == {"case_id": "case-a"}
        health = client.get("/health")  # an API route, not shadowed by the static mount
        assert health.status_code == 200 and health.json()["status"] == "ok"
        assert client.post("/redact", json={"text": "MRN: 1234567"}).json()["total"] == 1
        assert client.get("/no-such-page").status_code == 404
        # example scans are large: byte ranges must work so the browser can resume or skip
        ranged = client.get("/cases/case-a/manifest.json", headers={"range": "bytes=0-3"})
        assert ranged.status_code == 206 and len(ranged.content) == 4
    finally:
        monkeypatch.delenv("STATIC_DIR", raising=False)
        from app import config, main

        config.get_settings.cache_clear()
        importlib.reload(main)


def test_without_static_dir_nothing_is_mounted(monkeypatch):
    from app import config

    monkeypatch.delenv("STATIC_DIR", raising=False)
    config.get_settings.cache_clear()
    from app import main

    main = importlib.reload(main)
    assert all(getattr(r, "name", "") != "web" for r in main.app.routes)


def test_next_export_page_data_names_are_mapped():
    from app.webstatic import export_data_path

    assert export_data_path("passport/__next.passport.__PAGE__.txt") == "passport/__next.passport/__PAGE__.txt"
    assert export_data_path("passport/print/__next.passport.print.__PAGE__.txt") == "passport/print/__next.passport/print/__PAGE__.txt"
    assert export_data_path("__next.__PAGE__.txt") is None  # one part only: nothing to map
    assert export_data_path("passport/index.txt") is None
    assert export_data_path("cases/case-a/manifest.json") is None


def test_page_data_request_is_answered_from_the_exported_folder(tmp_path, monkeypatch):
    folder = tmp_path / "about" / "__next.about"
    folder.mkdir(parents=True)
    (folder / "__PAGE__.txt").write_text("payload", encoding="utf-8")
    (tmp_path / "index.html").write_text("home", encoding="utf-8")
    try:
        client = TestClient(make_app(monkeypatch, tmp_path))
        assert client.get("/about/__next.about.__PAGE__.txt").text == "payload"
        assert client.get("/about/__next.nothing.__PAGE__.txt").status_code == 404
    finally:
        monkeypatch.delenv("STATIC_DIR", raising=False)
        from app import config, main

        config.get_settings.cache_clear()
        importlib.reload(main)


def test_page_data_is_mapped_even_when_the_export_has_a_404_page(tmp_path, monkeypatch):
    folder = tmp_path / "passport" / "__next.passport"
    folder.mkdir(parents=True)
    (folder / "__PAGE__.txt").write_text("payload", encoding="utf-8")
    (tmp_path / "index.html").write_text("home", encoding="utf-8")
    (tmp_path / "404.html").write_text("not here", encoding="utf-8")  # Next exports one; Starlette then returns it as a 404 response
    try:
        client = TestClient(make_app(monkeypatch, tmp_path))
        ok = client.get("/passport/__next.passport.__PAGE__.txt?_rsc=abc")
        assert ok.status_code == 200 and ok.text == "payload"
        missing = client.get("/passport/__next.other.__PAGE__.txt")
        assert missing.status_code == 404 and missing.text == "not here"
    finally:
        monkeypatch.delenv("STATIC_DIR", raising=False)
        from app import config, main

        config.get_settings.cache_clear()
        importlib.reload(main)
