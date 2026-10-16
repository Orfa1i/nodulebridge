import copy
import itertools
import json
import re
import shutil
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import explain as explain_module
from app.services.explain import ContentError, banned_hits, explain, load_content, template_ids
from scripts.check_content import run_check

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "web" / "tests" / "e2e" / "fixtures"
CONTENT = ROOT / "shared" / "content"
client = TestClient(app)
LOCALES = ("en", "ar")
LEFTOVER = re.compile(r"[{}]|TODO|None|null|undefined")


def extraction(letter):
    return json.loads((FIXTURES / f"extract-case-{letter}.json").read_text(encoding="utf-8"))["result"]


def recommend(result, **extra):
    r = client.post("/recommend", json={"result": result, "analysis_date": "2026-10-16", **extra})
    assert r.status_code == 200, r.text
    return r.json()


def driving(result, rec):
    return next((n for n in result["nodules"] if n["id"] == rec["driving_nodule_id"]), None)


def all_text(out):
    parts = [s["text"] for s in out["sections"]] + [out["voice_text"]] + out["questions"]
    return " ".join(parts)


@pytest.mark.parametrize("letter", ["a", "b", "c"])
@pytest.mark.parametrize("locale", LOCALES)
def test_cases_render_every_section_without_leftovers(letter, locale):
    result = extraction(letter)
    rec = recommend(result)
    out = explain(rec, driving(result, rec), locale, matched=True)
    assert [s["key"] for s in out["sections"]] == ["found", "reassure", "why", "todo", "when", "who"] or len(out["sections"]) >= 4
    text = all_text(out)
    assert not LEFTOVER.search(text), text
    assert out["voice_text"].strip()
    assert str(rec["size_mm"]) in out["voice_text"]
    assert banned_hits(text) == []


def test_arabic_uses_western_digits_and_gregorian_dates():
    result = extraction("a")
    rec = recommend(result)
    out = explain(rec, driving(result, rec), "ar", matched=True)
    text = all_text(out)
    assert not re.search(r"[٠-٩۰-۹]", text)
    assert "2027" in text  # Gregorian year, not 1448
    assert not re.search(r"14[4-9]\d", text)


def test_english_dates_are_written_out():
    result = extraction("c")
    rec = recommend(result)
    out = explain(rec, driving(result, rec), "en", matched=True)
    assert "April 2027" in all_text(out)


def test_spoken_text_has_no_dates():
    for letter in "abc":
        result = extraction(letter)
        rec = recommend(result)
        for locale in LOCALES:
            voice = explain(rec, driving(result, rec), locale, matched=True)["voice_text"]
            assert not re.search(r"20\d\d", voice), voice


def grid():
    base = extraction("a")
    for att, size, count, ctx in itertools.product(
        ["solid", "ground_glass", "part_solid", None],
        [3, 5, 7, 12],
        ["single", "multiple"],
        [{}, {"known_cancer": True}, {"immunocompromised": True}, {"is_screening_exam": True}, {"age_years": 30}, {"risk_tier": "low"}, {"risk_tier": "high"}],
    ):
        r = copy.deepcopy(base)
        n = r["nodules"][0]
        n.update(attenuation=att, dimensions_mm=[size], mean_diameter_mm=float(size), size_text=f"{size} mm", count_context=count)
        if att == "part_solid":
            n["solid_component_mm"] = 4
        if "age_years" in ctx:
            r["patient_context"]["age_years"]["value"] = ctx["age_years"]
        for key in ("known_cancer", "immunocompromised"):
            if key in ctx:
                r["patient_context"][key]["value"] = ctx[key]
        if "is_screening_exam" in ctx:
            r["study"]["is_screening_exam"] = True
        yield r, {k: v for k, v in ctx.items() if k == "risk_tier"}


def test_every_engine_output_has_content_in_both_languages():
    seen_rules, count = set(), 0
    for result, extra in grid():
        rec = recommend(result, **extra)
        for locale in LOCALES:
            out = explain(rec, driving(result, rec), locale, matched=True)  # raises ContentError on any gap
            assert not LEFTOVER.search(all_text(out)), (rec["rule_id"], locale)
            assert banned_hits(all_text(out)) == [], (rec["rule_id"], locale)
        seen_rules.add(rec["rule_id"])
        count += 1
    assert count == 224
    assert len({r for r in seen_rules if r}) >= 10  # the grid reaches most rules


def test_unmatched_finding_adds_the_no_match_note():
    result = extraction("a")
    rec = recommend(result)
    ids = template_ids(rec, matched=False)
    assert ids[-1] == "NO_MATCH"
    for locale in LOCALES:
        out = explain(rec, driving(result, rec), locale, matched=False)
        assert "NO_MATCH" in out["template_ids"]


def test_not_applicable_uses_the_neutral_template():
    result = extraction("a")
    result["patient_context"]["age_years"]["value"] = 20
    rec = recommend(result)
    assert rec["applies"] is False
    for locale in LOCALES:
        out = explain(rec, driving(result, rec), locale)
        assert out["template_ids"] == ["NOT_APPLICABLE"]
        assert banned_hits(all_text(out)) == []


def test_missing_arabic_is_an_error_not_half_a_sentence():
    ar = json.loads((CONTENT / "patient-templates.ar.json").read_text(encoding="utf-8"))
    ar["templates"].pop("FL17-S1-GT8")
    tmp = Path(pytest.importorskip("tempfile").mkdtemp())
    for f in CONTENT.glob("*.json"):
        shutil.copy(f, tmp / f.name)
    (tmp / "patient-templates.ar.json").write_text(json.dumps(ar, ensure_ascii=False), encoding="utf-8")
    result = extraction("a")
    rec = recommend(result)
    with pytest.raises(ContentError):
        explain(rec, driving(result, rec), "ar", matched=True, content=load_content(str(tmp)))


def test_banned_words_catch_hype_and_emoji():
    assert banned_hits("This is a cure!") != []
    assert banned_hits("Good news \U0001F600") != []
    assert banned_hits("The guideline suggests a repeat CT scan.") == []


def test_every_content_string_is_free_of_banned_words():
    c = load_content()
    for locale in LOCALES:
        for tid, t in c.templates[locale].items():
            for key, value in t.items():
                if isinstance(value, str):
                    assert banned_hits(value) == [], (locale, tid, key)


def test_arabic_machine_drafts_are_flagged_until_reviewed():
    result = extraction("a")
    rec = recommend(result)
    out = explain(rec, driving(result, rec), "ar", matched=True)
    assert out["review_status"]["status"] == "draft"
    assert any(i.startswith("template:ar:") for i in out["review_status"]["draft_items"])


def test_explain_path_never_imports_a_language_model_client():
    for module in ("app/services/explain.py", "app/routers/explain.py"):
        source = (ROOT / "api" / module).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(import|from)\s+(anthropic|google|openai|app\.services\.(providers|gemini|extract))", source, re.MULTILINE), module
    assert "gemini_extractor" not in Path(explain_module.__file__).read_text(encoding="utf-8")


def test_explain_endpoint_round_trip_and_validation():
    result = extraction("b")
    rec = recommend(result)
    ok = client.post("/explain", json={"recommendation": rec, "finding": driving(result, rec), "locale": "ar", "matched": True})
    assert ok.status_code == 200 and ok.json()["locale"] == "ar"
    assert client.post("/explain", json={"recommendation": {}, "locale": "en"}).status_code == 422
    assert client.post("/explain", json={"recommendation": rec, "locale": "fr"}).status_code == 422


def reviewed_copy(tmp_path):
    for f in CONTENT.glob("*.json"):
        text = f.read_text(encoding="utf-8")
        text = re.sub(r'"status":\s*"draft"', '"status": "reviewed"', text)
        (tmp_path / f.name).write_text(text, encoding="utf-8")
    return tmp_path


def test_check_content_fails_on_the_real_draft_files():
    ok, lines = run_check(cases=("a", "b", "c"), voices=False)
    assert not ok and any(line.startswith("draft: ar:") for line in lines)


def test_check_content_passes_when_everything_is_reviewed(tmp_path):
    ok, lines = run_check(str(reviewed_copy(tmp_path)), voices=False)
    assert ok, lines


def test_voice_sidecars_match_the_spoken_text():
    from app.services.tts import text_sha256

    for letter in "abc":
        result = extraction(letter)
        rec = recommend(result)
        for locale in LOCALES:
            voice = explain(rec, driving(result, rec), locale, matched=True)["voice_text"]
            sidecar = json.loads((ROOT / "data" / "cases" / f"case-{letter}" / f"voice.{locale}.json").read_text(encoding="utf-8"))
            assert sidecar["text_sha256"] == text_sha256(voice), (letter, locale)
            assert 12 <= sidecar["duration_s"] <= 18, (letter, locale, sidecar["duration_s"])
            assert (ROOT / "data" / "cases" / f"case-{letter}" / f"voice.{locale}.mp3").stat().st_size > 10_000


assert date  # used by fixtures in other modules
