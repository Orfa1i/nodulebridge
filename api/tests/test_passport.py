import base64
import json
import re
import socket
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from fhir.resources.R4B.bundle import Bundle
from icalendar import Calendar

from app.config import Settings
from app.main import app
from app.routers import passport as passport_router
from app.services import passport as svc
from app.services.explain import banned_hits

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "web" / "tests" / "e2e" / "fixtures"
client = TestClient(app)
SERIES = "1.3.6.1.4.1.14519.5.2.1.6279.6001.200841000324240313648595016964"
STUDY = "1.3.6.1.4.1.14519.5.2.1.6279.6001.280531413986295071283803322793"


def extraction(letter):
    return json.loads((FIXTURES / f"extract-case-{letter}.json").read_text(encoding="utf-8"))


def make_payload(letter="a", result_patch=None, **over):
    data = extraction(letter)
    result = data["result"]
    if result_patch:
        result_patch(result)
    rec = client.post("/recommend", json={"result": result, "analysis_date": "2026-10-16"}).json()
    finding = next(n for n in result["nodules"] if n["id"] == rec["driving_nodule_id"])
    explanation = {
        loc: client.post("/explain", json={"recommendation": rec, "finding": finding, "locale": loc, "matched": True}).json() for loc in ("en", "ar")
    }
    payload = {
        "label": f"Example patient {letter.upper()}",
        "case_id": f"case-{letter}",
        "patient_ref": "LIDC-IDRI-0213",
        "study_instance_uid": STUDY,
        "series_instance_uid": SERIES,
        "created_on": "2026-10-16",
        "report_text": "\n".join(s["text"] for s in data["sentences"]),
        "evidence_quote": finding["evidence"][0]["quote"],
        "finding": finding,
        "recommendation": rec,
        "explanation": explanation,
        "image_data_url": None,
        "attribution": "CT images: LIDC-IDRI collection (TCIA).",
        "timezone": "Asia/Riyadh",
    }
    payload.update(over)
    return payload


def model(payload):
    return svc.PassportPayload.model_validate(payload)


# ---------- booking request ----------


@pytest.mark.parametrize("locale", ["en", "ar"])
def test_booking_request_states_what_the_guideline_suggests_and_asks_the_doctor(locale):
    out = svc.booking_request(model(make_payload()), locale)
    body = out["body"]
    assert "9 mm solid nodule" in body  # the report's own words, verbatim
    assert "Fleischner" in body and "2027" in body and "FL17" not in body
    assert banned_hits(body.rsplit("\n\n", 1)[0]) == []  # everything but the fixed sign-off, which says "not a diagnosis"
    assert not re.search(r"you have cancer|has cancer|you need (a|an) ", body, re.IGNORECASE)
    assert body.rstrip().endswith(svc.text("booking.signoff", locale))
    assert out["review_status"]["status"] == "draft"  # until a clinician reviews the Arabic and the English


def test_english_booking_request_reads_as_a_letter():
    body = svc.booking_request(model(make_payload()), "en")["body"]
    assert body.startswith("Dear Doctor,")
    assert "Please decide what is right for me." in body
    assert "Prepared with NoduleBridge (decision support, not a diagnosis)" in body
    assert "Is your immune system weakened?" in body  # the open question travels with the request


def test_booking_request_without_a_window_asks_to_talk_about_the_next_step():
    def patch(result):
        result["patient_context"]["age_years"]["value"] = 20  # the guideline does not apply: no options, no date

    out = svc.booking_request(model(make_payload(result_patch=patch)), "en")
    assert "talk about the next step" in out["body"]


def test_booking_endpoint_and_validation():
    ok = client.post("/passport/booking", json={"passport": make_payload(), "locale": "ar"})
    assert ok.status_code == 200 and "subject" in ok.json()
    bad = make_payload()
    bad["explanation"].pop("ar")
    assert client.post("/passport/booking", json={"passport": bad, "locale": "en"}).status_code == 422
    assert client.post("/passport/booking", json={"passport": make_payload(timezone="Mars/Base"), "locale": "en"}).status_code == 422
    assert client.post("/passport/booking", json={"passport": make_payload(image_data_url="data:text/html;base64,AAAA"), "locale": "en"}).status_code == 422


# ---------- FHIR ----------


def bundle_of(payload):
    return svc.fhir_bundle(model(payload))


def by_type(bundle, rtype):
    return [e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == rtype]


def test_fhir_bundle_validates_and_has_one_service_request_with_the_due_window():
    bundle = bundle_of(make_payload())
    Bundle.model_validate(bundle)  # fhir.resources R4B validation
    assert bundle["resourceType"] == "Bundle" and bundle["type"] == "collection"
    assert sorted(e["resource"]["resourceType"] for e in bundle["entry"]) == ["CarePlan", "DiagnosticReport", "ImagingStudy", "Observation", "Patient", "ServiceRequest"]
    (sr,) = by_type(bundle, "ServiceRequest")
    assert sr["occurrencePeriod"] == {"start": "2027-01-16", "end": "2027-01-16"}
    assert sr["intent"] == "proposal" and sr["status"] == "draft"  # a guideline suggestion, not an order
    assert "FL17-S1-GT8" in sr["note"][0]["text"] and "Fleischner" in sr["note"][0]["text"]
    (obs,) = by_type(bundle, "Observation")
    assert sr["reasonReference"][0]["reference"] in {e["fullUrl"] for e in bundle["entry"]}
    size = next(c for c in obs["component"] if "size" in c["code"]["text"].lower())
    assert size["valueQuantity"] == {"value": 9.0, "unit": "mm", "system": "http://unitsofmeasure.org", "code": "mm"}
    (plan,) = by_type(bundle, "CarePlan")
    assert plan["activity"][0]["reference"]["reference"] == next(e["fullUrl"] for e in bundle["entry"] if e["resource"]["resourceType"] == "ServiceRequest")


def test_fhir_patient_is_an_example_without_identifiers_and_report_is_carried():
    bundle = bundle_of(make_payload())
    (patient,) = by_type(bundle, "Patient")
    assert "identifier" not in patient and patient["meta"]["tag"][0]["code"] == "example"
    (report,) = by_type(bundle, "DiagnosticReport")
    assert report["status"] == "final" and report["conclusion"].startswith("a 9 mm solid nodule")
    assert base64.b64decode(report["presentedForm"][0]["data"]).decode("utf-8").startswith(extraction("a")["sentences"][0]["text"])
    (study,) = by_type(bundle, "ImagingStudy")
    assert study["series"][0]["uid"] == SERIES


def test_fhir_uses_text_only_codes_until_codes_are_verified():
    raw = json.dumps(bundle_of(make_payload()))
    assert "snomed" not in raw.lower() and "loinc" not in raw.lower()


def test_fhir_has_no_service_request_when_the_guideline_names_no_date():
    def patch(result):
        result["patient_context"]["age_years"]["value"] = 20  # the guideline does not apply: no options, no date

    bundle = bundle_of(make_payload(result_patch=patch))
    Bundle.model_validate(bundle)
    assert by_type(bundle, "ServiceRequest") == [] and by_type(bundle, "CarePlan") == []


def test_fhir_endpoint_returns_fhir_json_download():
    r = client.post("/passport/fhir", json={"passport": make_payload()})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/fhir+json")
    assert "attachment" in r.headers["content-disposition"]
    Bundle.model_validate(r.json())


# ---------- calendar ----------


def parse(data):
    return Calendar.from_ical(data)


def events(cal):
    return [c for c in cal.walk("VEVENT")]


def test_ics_has_two_events_with_the_right_dates_and_alarms():
    now = datetime(2026, 10, 16, 12, 0, tzinfo=ZoneInfo("Asia/Riyadh"))
    cal = parse(svc.ics_file(model(make_payload()), "en", now=now))
    book, window = events(cal)
    assert str(book["summary"]) == "Book your follow-up CT"
    assert book["dtstart"].dt.date() == date(2026, 10, 19) and str(book["dtstart"].dt.tzinfo) == "Asia/Riyadh"
    assert len(list(book.walk("VALARM"))) >= 1
    assert str(window["summary"]) == "Follow-up CT window opens"
    assert window["dtstart"].dt.date() == date(2027, 1, 16)
    triggers = sorted(a["trigger"].dt.days for a in window.walk("VALARM"))
    assert triggers == [-14, -1]
    assert "Not a diagnosis" in str(window["description"]) and "doctor" in str(window["description"])


def test_caregiver_calendar_uses_the_helper_summary():
    cal = parse(svc.ics_file(model(make_payload()), "en", caregiver=True))
    assert all(str(e["summary"]) == "Help Example patient A book the follow-up CT" for e in events(cal))
    patient = parse(svc.ics_file(model(make_payload()), "en"))
    assert {str(e["uid"]) for e in events(cal)}.isdisjoint({str(e["uid"]) for e in events(patient)})


def test_arabic_calendar_text_is_arabic_but_the_safety_statement_stays_english_until_reviewed():
    cal = parse(svc.ics_file(model(make_payload()), "ar"))
    description = str(events(cal)[1]["description"])
    assert re.search(r"[؀-ۿ]", description)
    assert "Decision and adherence support only" in description  # TODO-VERIFY: Arabic wording from a clinician


def test_calendar_timezone_is_configurable():
    cal = parse(svc.ics_file(model(make_payload(timezone="Europe/London")), "en"))
    assert str(events(cal)[1]["dtstart"].dt.tzinfo) == "Europe/London"


def test_ics_endpoint_returns_a_calendar_file():
    r = client.post("/passport/ics", json={"passport": make_payload(), "locale": "en", "caregiver": True})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    assert r.content.startswith(b"BEGIN:VCALENDAR")


# ---------- mock WhatsApp ----------


def test_whatsapp_is_logged_not_sent(tmp_path, monkeypatch):
    monkeypatch.setattr(passport_router, "get_settings", lambda: Settings(_env_file=None, data_dir=tmp_path))
    r = client.post("/mock/whatsapp", json={"message": "Hello", "locale": "en", "label": "Example patient A"})
    assert r.status_code == 200 and r.json() == {"status": "mocked"}
    line = json.loads((tmp_path / "mock-outbox.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["status"] == "mocked" and line["channel"] == "whatsapp" and line["message"] == "Hello"


def test_passport_code_never_calls_a_messaging_or_model_api():
    source = (ROOT / "api" / "app" / "services" / "passport.py").read_text(encoding="utf-8") + (ROOT / "api" / "app" / "routers" / "passport.py").read_text(encoding="utf-8")
    assert not re.search(r"twilio|graph\.facebook|api\.whatsapp|anthropic|generativelanguage|openai", source, re.IGNORECASE)


# ---------- PDF (needs the web app running; skipped otherwise) ----------


def web_is_up() -> bool:
    try:
        with socket.create_connection(("localhost", 3000), timeout=1):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not web_is_up(), reason="the web app is not running on localhost:3000")
def test_pdf_has_the_rule_id_arabic_text_and_the_safety_statement(tmp_path):
    import pdfplumber

    r = client.post("/passport/pdf", json={"passport": make_payload()})
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    out = tmp_path / "passport.pdf"
    out.write_bytes(r.content)
    with pdfplumber.open(out) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)
        assert len(pdf.pages) >= 2
        assert abs(pdf.pages[0].width - 595) < 3 and abs(pdf.pages[0].height - 842) < 3  # A4 in points
    assert "FL17-S1-GT8" in text
    assert len(re.findall(r"[؀-ۿﭐ-﷿ﹰ-﻿]", text)) > 100  # Arabic is present (shaped forms count)
    assert "Decision and adherence support only" in text  # the footer statement
    assert "Page 1" in text


def test_pdf_failure_is_a_plain_error_and_not_a_crash(monkeypatch):
    monkeypatch.setattr(passport_router, "get_settings", lambda: Settings(_env_file=None, web_base_url="http://127.0.0.1:9", data_dir=Path.cwd()))
    monkeypatch.setattr(svc, "render_pdf", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Chromium is not installed")))
    r = client.post("/passport/pdf", json={"passport": make_payload()})
    assert r.status_code == 502
    err = r.json()["error"]
    assert err["code"] == "pdf_unavailable" and "Print" in err["message"] and "Chromium" in err["detail"]
