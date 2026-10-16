import glob
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.redact import MARKER, redact

client = TestClient(app)
ROOT = Path(__file__).resolve().parents[2]

REPORT = """Patient: Jane Q. Doe
MRN: 00482913
DOB: 14/03/1961
Phone: +966 50 123 4567
Email: jane.doe@example.org
Accession No. ACC-2024-889
CT chest, 29 February 2024.
A 9 mm solid nodule is seen in the right upper lobe.
"""


def test_each_kind_is_found_and_replaced_and_clinical_text_is_untouched():
    r = redact(REPORT)
    assert r.items == {"name": 1, "id": 2, "dob": 1, "phone": 1, "email": 1}
    assert r.total == 6
    for secret in ("Jane Q. Doe", "00482913", "14/03/1961", "123 4567", "jane.doe@example.org", "ACC-2024-889"):
        assert secret not in r.text, secret
    assert "A 9 mm solid nodule is seen in the right upper lobe." in r.text
    assert "29 February 2024" in r.text  # the date of the scan stays
    assert r.text.count(MARKER) == 6


def test_labels_are_kept_so_the_reader_sees_what_was_removed():
    assert redact("MRN: 5551234").text == f"MRN: {MARKER}"
    assert redact("Patient name: Ali Hassan").text == f"Patient name: {MARKER}"
    assert redact("Date of birth: 1961-03-14").text == f"Date of birth: {MARKER}"


def test_clinical_patient_lines_are_not_names():
    for line in ("Patient: 30-year-old woman.", "Patient: 58 year old man, former smoker.", "Patient: female, 42 y/o"):
        assert redact(line).total == 0, line


def test_measurements_and_ordinary_numbers_are_not_phone_numbers():
    text = "A 9 mm nodule, slice 71/104, HU 35, 2.5 mm slices, follow-up in 3 to 6 months, scan 2024-02-29."
    assert redact(text).total == 0


def test_redaction_is_idempotent():
    once = redact(REPORT)
    assert redact(once.text).total == 0 and redact(once.text).text == once.text


def test_no_prepared_or_eval_report_changes():
    texts = [Path(f).read_text(encoding="utf-8") for f in glob.glob(str(ROOT / "api" / "tests" / "eval" / "cases" / "*.txt"))]
    texts += [p.read_text(encoding="utf-8") for p in (ROOT / "data" / "cases").glob("case-*/report.md")]
    assert len(texts) >= 20
    assert [i for i, t in enumerate(texts) if redact(t).total] == []


def test_redact_endpoint_text_and_pdf():
    ok = client.post("/redact", json={"text": REPORT})
    body = ok.json()
    assert ok.status_code == 200 and body["total"] == 6 and body["complete"] is False
    assert {i["label"] for i in body["items"]} == {"name", "ID number", "date of birth", "phone number", "e-mail address"}
    pdf = (ROOT / "web" / "public" / "cases" / "case-a" / "report.pdf").read_bytes()
    r = client.post("/redact", files={"file": ("report.pdf", pdf, "application/pdf")})
    assert r.status_code == 200 and r.json()["total"] == 0 and "9 mm solid nodule" in r.json()["text"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"json": {"text": "   "}},
        {"json": {"nope": 1}},
        {"content": b"x", "headers": {"content-type": "text/plain"}},
        {"files": {"file": ("a.pdf", b"not a pdf", "application/pdf")}},
    ],
)
def test_redact_endpoint_errors_are_plain(kwargs):
    r = client.post("/redact", **kwargs)
    assert r.status_code == 422 and r.json()["error"]["message"] == "The report could not be read. Paste the text instead."


def test_redaction_code_calls_no_model():
    source = (ROOT / "api" / "app" / "services" / "redact.py").read_text(encoding="utf-8") + (ROOT / "api" / "app" / "routers" / "redact.py").read_text(encoding="utf-8")
    assert "anthropic" not in source.lower() and "generativelanguage" not in source
