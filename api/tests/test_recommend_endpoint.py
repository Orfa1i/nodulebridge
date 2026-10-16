import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app.main import app

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "web" / "tests" / "e2e" / "fixtures"
SCHEMA = json.loads((ROOT / "shared" / "schemas" / "followup-recommendation.schema.json").read_text(encoding="utf-8"))
client = TestClient(app)


def result_of(letter):
    return json.loads((FIXTURES / f"extract-case-{letter}.json").read_text(encoding="utf-8"))["result"]


def post(letter="a", **extra):
    return client.post("/recommend", json={"result": result_of(letter), "analysis_date": "2026-10-16", **extra})


def test_case_a_matches_the_phase_table_and_validates():
    r = post("a")
    assert r.status_code == 200
    body = r.json()
    assert list(Draft202012Validator(SCHEMA).iter_errors(body)) == []
    assert body["rule_id"] == "FL17-S1-GT8" and body["size_mm"] == 9 and body["count"] == "single"
    assert body["headline"] == "Consider a CT in about 3 months, a PET-CT, or a biopsy."
    assert body["options"][0]["actions"][0]["window_start"] == "2027-01-16"
    assert body["applies"] == "conditional"  # the report does not say whether the immune system is weakened
    assert body["questions_for_doctor"] == ["Is your immune system weakened?"]
    assert body["why"].startswith("Single solid nodule, 9 mm (the report gives one dimension), Fleischner 2017, rule FL17-S1-GT8")
    assert "Upper lobe location (stated in the report)" in body["factors_to_consider"]
    assert "Former smoking (stated in the report)" in body["factors_to_consider"]


def test_case_b_shows_both_risk_options_when_the_tier_is_unknown():
    body = post("b").json()
    assert body["rule_id"] == "FL17-S1-6TO8"
    assert [o["label"] for o in body["options"]] == [
        "If your doctor considers your risk low", "If your doctor considers your risk higher",
    ]  # fmt: skip


def test_case_c_applies_without_questions():
    body = post("c").json()
    assert body["rule_id"] == "FL17-GGN1-GE6" and body["applies"] is True and body["questions_for_doctor"] == []
    assert body["options"][0]["actions"][0]["window_start"] == "2027-04-16"
    assert body["options"][0]["actions"][0]["window_end"] == "2027-10-16"


def test_user_confirmations_resolve_the_conditional():
    body = post("a", immunocompromised=False).json()
    assert body["applies"] is True and body["questions_for_doctor"] == []
    body = post("a", immunocompromised=True).json()
    assert body["applies"] is False and body["rule_id"] is None


def test_either_source_can_exclude_but_a_user_cannot_cancel_a_report_exclusion():
    result = result_of("a")
    result["patient_context"]["known_cancer"]["value"] = True
    r = client.post("/recommend", json={"result": result, "known_cancer": False, "analysis_date": "2026-10-16"})
    assert r.json()["applies"] is False


def test_age_confirmation_and_risk_tier():
    result = result_of("a")
    result["patient_context"]["age_years"]["value"] = None
    unknown = client.post("/recommend", json={"result": result, "immunocompromised": False}).json()
    assert unknown["applies"] == "conditional" and "Are you 35 years or older?" in unknown["questions_for_doctor"]
    ok = client.post("/recommend", json={"result": result, "immunocompromised": False, "age_at_least_35": True}).json()
    assert ok["applies"] is True
    low = post("b", risk_tier="low").json()
    assert low["risk_tier_used"] == "low" and len(low["options"]) == 1


def test_study_date_from_the_report_is_used():
    result = result_of("a")
    result["study"]["study_date"] = "2026-08-31"
    body = client.post("/recommend", json={"result": result, "immunocompromised": False}).json()
    assert body["date_basis"] == "study_date" and body["index_date"] == "2026-08-31"
    result["study"]["study_date"] = "not a date"
    body = client.post("/recommend", json={"result": result, "analysis_date": "2026-10-16"}).json()
    assert body["date_basis"] == "analysis_date"


@pytest.mark.parametrize(
    "body",
    [{"result": {}}, {"result": {"nodules": "x"}}, {"result": {"nodules": []}, "risk_tier": "medium"}, {"result": {"nodules": []}, "age_years": -1}, {}],
)
def test_bad_requests_are_rejected(body):
    assert client.post("/recommend", json=body).status_code == 422


def test_no_nodules_is_not_an_error():
    body = client.post("/recommend", json={"result": {"nodules": []}}).json()
    assert body["applies"] is False and body["citation"]["text"]
