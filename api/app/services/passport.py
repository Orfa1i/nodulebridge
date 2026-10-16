"""The referral passport: booking request, FHIR summary, calendar files and the PDF.

Everything here is deterministic. No language model is called; the wording comes from reviewed templates
(shared/content/passport.json and the explain service). The booking request states what the guideline suggests and asks
the doctor to decide. It never says the patient has cancer and never asks for a specific test.

Codes: only `text` (and display) is used. SNOMED CT and LOINC codes are NOT added because they were not verified in the
official browsers.
TODO-VERIFY: add SNOMED CT / LOINC codes for "pulmonary nodule", "CT of chest" and the report type after checking them.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fhir.resources.R4B.bundle import Bundle
from icalendar import Alarm, Calendar, Event
from pydantic import BaseModel, Field, field_validator

from app.config import ROOT
from app.services.explain import ContentError, banned_hits

CONTENT_FILE = ROOT / "shared" / "content" / "passport.json"
LOCALES = ("en", "ar")
DEFAULT_TZ = "Asia/Riyadh"
MAX_IMAGE_BYTES = 3_000_000
PDF_READY_SELECTOR = '[data-print-ready="true"]'
SAFETY_STATEMENT = "Decision and adherence support only — not a diagnosis. Follow-up decisions belong to your doctor."


class PassportPayload(BaseModel):
    """What the browser sends: the stored analysis, already in both languages."""

    label: str = Field(max_length=80, description="For example 'Example patient A'.")
    case_id: str | None = None
    patient_ref: str | None = Field(default=None, description="For example 'LIDC-IDRI-0213'. Example data only.")
    study_instance_uid: str | None = None
    series_instance_uid: str | None = None
    created_on: date = Field(default_factory=date.today)
    report_text: str = Field(max_length=60_000)
    evidence_quote: str | None = Field(default=None, max_length=2000)
    finding: dict[str, Any] | None = None
    recommendation: dict[str, Any]
    explanation: dict[str, dict[str, Any]]
    image_data_url: str | None = None
    attribution: str | None = Field(default=None, max_length=1000)
    timezone: str = DEFAULT_TZ

    @field_validator("image_data_url")
    @classmethod
    def _png_only(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.startswith("data:image/png;base64,") or len(v) > MAX_IMAGE_BYTES * 4 // 3:
            raise ValueError("image_data_url must be a PNG data URL under 3 MB")
        return v

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown time zone {v!r}") from exc
        return v

    @field_validator("explanation")
    @classmethod
    def _both_languages(cls, v: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        if not all(k in v for k in LOCALES):
            raise ValueError("explanation needs both 'en' and 'ar'")
        return v


@lru_cache(maxsize=1)
def load_strings(path: str | None = None) -> dict[str, dict[str, str]]:
    return json.loads(Path(path or CONTENT_FILE).read_text(encoding="utf-8"))["strings"]


def text(key: str, locale: str, strings: dict[str, dict[str, str]] | None = None, **fmt: str) -> str:
    entry = (strings or load_strings()).get(key)
    if entry is None:
        raise ContentError(f"missing passport string {key!r}")
    value = entry.get(locale)
    if not value:
        if key == "ics.statement" and locale == "ar":
            return entry["en"]  # the Arabic safety statement must come from a clinician; until then English is shown
        raise ContentError(f"no {locale} text for passport string {key!r}")
    return value.format(**fmt) if fmt else value


def draft_keys(keys: list[str], locale: str, strings: dict[str, dict[str, str]] | None = None) -> list[str]:
    strings = strings or load_strings()
    out = [k for k in keys if strings[k]["status"] != "reviewed"]
    return [f"passport:{locale}:{k}" for k in out]


# ---------- booking request ----------


def booking_request(p: PassportPayload, locale: str, strings: dict[str, dict[str, str]] | None = None) -> dict[str, Any]:
    exp = p.explanation[locale]
    rec = p.recommendation
    used = ["booking.subject", "booking.greeting", "booking.decide", "booking.thanks", "booking.signoff"]
    lines = [text("booking.greeting", locale, strings)]
    if p.evidence_quote:
        lines.append(text("booking.finding", locale, strings, quote=f"“{p.evidence_quote}”"))
        used.append("booking.finding")
    if exp.get("action_text"):
        lines.append(text("booking.guideline", locale, strings, action_text=exp["action_text"]))
        used.append("booking.guideline")
    window = exp.get("window")
    if window and window["same_day"]:
        lines.append(text("booking.ask_around", locale, strings, window_start=window["start"]))
        used.append("booking.ask_around")
    elif window:
        lines.append(text("booking.ask_window", locale, strings, window_start=window["start"], window_end=window["end"]))
        used.append("booking.ask_window")
    else:
        lines.append(text("booking.ask_open", locale, strings))
        used.append("booking.ask_open")
    if exp.get("questions"):
        lines.append(text("booking.questions", locale, strings, questions=" ".join(exp["questions"])))
        used.append("booking.questions")
    lines.append(text("booking.decide", locale, strings))
    if rec.get("citation"):
        lines.append(text("booking.source", locale, strings, citation=rec["citation"]["text"]))
        used.append("booking.source")
    lines.append(text("booking.thanks", locale, strings))
    hits = banned_hits("\n\n".join(lines))  # the fixed sign-off says "not a diagnosis" on purpose, so it is left out of this check
    lines.append(text("booking.signoff", locale, strings))
    body = "\n\n".join(lines)
    if hits:
        raise ContentError(f"booking request contains banned words: {hits}")
    return {
        "locale": locale,
        "subject": text("booking.subject", locale, strings),
        "body": body,
        "review_status": {"status": "draft" if draft_keys(used, locale, strings) else "reviewed", "draft_items": draft_keys(used, locale, strings)},
    }


# ---------- FHIR ----------


def _uid_value(uid: str) -> str:
    return f"urn:oid:{uid}"


def due_window(rec: dict[str, Any]) -> tuple[str, str] | None:
    """The first CT window of the first option (the earliest follow-up the guideline names), or None."""

    def walk(actions: list[dict[str, Any]]) -> tuple[str, str] | None:
        for a in actions:
            if a["type"] == "CT" and a.get("window_start"):
                return a["window_start"], a["window_end"]
            hit = walk(a.get("then", []))
            if hit:
                return hit
        return None

    for opt in rec.get("options", []):
        hit = walk(opt["actions"])
        if hit:
            return hit
    return None


def fhir_bundle(p: PassportPayload) -> dict[str, Any]:
    """FHIR R4 collection Bundle, validated by fhir.resources before it is returned."""
    rec, finding = p.recommendation, p.finding or {}
    ids = {k: f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'nodulebridge/{p.case_id or p.label}/{k}')}" for k in ("patient", "study", "report", "obs", "sr", "plan")}
    ref = lambda k: {"reference": ids[k]}
    patient_ref = {"reference": ids["patient"]}
    entries: list[dict[str, Any]] = []

    def add(key: str, resource: dict[str, Any]) -> None:
        entries.append({"fullUrl": ids[key], "resource": resource})

    add("patient", {"resourceType": "Patient", "meta": {"tag": [{"system": "urn:nodulebridge:tag", "code": "example", "display": "Example data, not a real person"}]}, "active": True, "name": [{"text": p.label}]})

    if p.series_instance_uid:
        study = {
            "resourceType": "ImagingStudy",
            "status": "available",
            "subject": patient_ref,
            "description": "Chest CT (example data from the LIDC-IDRI collection)",
            "series": [
                {
                    "uid": p.series_instance_uid,
                    # TODO-VERIFY: replace the display-only modality with the DICOM DCM code after checking it in the official browser
                    "modality": {"display": "CT"},
                    "description": "Chest CT series",
                }
            ],
        }
        if p.study_instance_uid:
            study["identifier"] = [{"system": "urn:dicom:uid", "value": _uid_value(p.study_instance_uid)}]
        add("study", study)

    quote = p.evidence_quote or "Pulmonary nodule described in the report."
    obs_components: list[dict[str, Any]] = []
    if rec.get("size_mm") is not None:
        obs_components.append({"code": {"text": "Nodule size (mean diameter)"}, "valueQuantity": {"value": rec["size_mm"], "unit": "mm", "system": "http://unitsofmeasure.org", "code": "mm"}})
    place = " ".join(x for x in (finding.get("side"), finding.get("lobe")) if x)
    if place:
        obs_components.append({"code": {"text": "Location (side and lobe, as stated in the report)"}, "valueString": place})
    if finding.get("attenuation"):
        obs_components.append({"code": {"text": "Attenuation type"}, "valueString": str(finding["attenuation"]).replace("_", " ")})
    observation: dict[str, Any] = {
        "resourceType": "Observation",
        "status": "final",
        "code": {"text": "Pulmonary nodule described in a chest CT report"},
        "subject": patient_ref,
        "valueString": quote,
    }
    if obs_components:
        observation["component"] = obs_components
    add("obs", observation)

    add(
        "report",
        {
            "resourceType": "DiagnosticReport",
            "status": "final",
            "code": {"text": "Chest CT report"},
            "subject": patient_ref,
            "conclusion": quote,
            "result": [ref("obs")],
            "presentedForm": [{"contentType": "text/plain; charset=utf-8", "language": "en", "title": "Chest CT report text", "data": base64.b64encode(p.report_text.encode("utf-8")).decode("ascii")}],
        },
    )
    if p.series_instance_uid:
        entries[-1]["resource"]["imagingStudy"] = [ref("study")]

    window = due_window(rec)
    if window:
        citation = (rec.get("citation") or {}).get("text", "")
        add(
            "sr",
            {
                "resourceType": "ServiceRequest",
                # a guideline suggestion, not an order: intent "proposal", status "draft". The doctor decides.
                "status": "draft",
                "intent": "proposal",
                "code": {"text": "Follow-up chest CT (guideline suggestion, to be decided by the doctor)"},
                "subject": patient_ref,
                "occurrencePeriod": {"start": window[0], "end": window[1]},
                "reasonReference": [ref("obs")],
                "note": [{"text": f"Rule {rec.get('rule_id')} · {rec.get('headline')} · {citation}"}],
            },
        )
        add(
            "plan",
            {
                "resourceType": "CarePlan",
                "status": "draft",
                "intent": "proposal",
                "title": "Follow-up plan (guideline suggestion)",
                "subject": patient_ref,
                "activity": [{"reference": ref("sr")}],
            },
        )

    bundle = Bundle.model_validate({"resourceType": "Bundle", "type": "collection", "timestamp": datetime.now(UTC).isoformat(timespec="seconds"), "entry": entries})
    return json.loads(bundle.model_dump_json(exclude_none=True))


# ---------- calendar ----------


def _at(d: date, tz: ZoneInfo, hour: int = 9) -> datetime:
    return datetime.combine(d, time(hour, 0), tzinfo=tz)


def _alarm(before: timedelta, summary: str) -> Alarm:
    a = Alarm()
    a.add("action", "DISPLAY")
    a.add("description", summary)
    a.add("trigger", -before)
    return a


def ics_file(p: PassportPayload, locale: str, caregiver: bool = False, now: datetime | None = None) -> bytes:
    tz = ZoneInfo(p.timezone)
    today = (now or datetime.now(tz)).astimezone(tz)
    exp = p.explanation[locale]
    statement = text("ics.statement", locale)
    description = f"{text('ics.description', locale, action_text=exp.get('action_text', ''))}\n\n{statement}".strip()
    cal = Calendar()
    cal.add("prodid", "-//Asklevia NoduleBridge//Follow-up passport//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-timezone", p.timezone)
    who = "caregiver" if caregiver else "patient"
    stamp = today.astimezone(UTC)

    def event(key: str, summary: str, start: datetime, alarms: list[timedelta]) -> Event:
        e = Event()
        e.add("uid", f"{hashlib.sha256(f'{p.case_id or p.label}|{key}|{who}'.encode()).hexdigest()[:32]}@nodulebridge.example")
        e.add("dtstamp", stamp)
        e.add("summary", summary)
        e.add("description", description)
        e.add("dtstart", start)
        e.add("dtend", start + timedelta(hours=1))
        for before in alarms:
            e.add_component(_alarm(before, summary))
        return e

    book_summary = text("ics.caregiver_summary", locale, name=p.label) if caregiver else text("ics.book_summary", locale)
    cal.add_component(event("book", book_summary, _at(today.date() + timedelta(days=3), tz), [timedelta(minutes=0)]))
    window = due_window(p.recommendation)
    if window:
        opens = date.fromisoformat(window[0])
        summary = text("ics.caregiver_summary", locale, name=p.label) if caregiver else text("ics.window_summary", locale)
        cal.add_component(event("window", summary, _at(opens, tz), [timedelta(days=14), timedelta(days=1)]))
    cal.add_missing_timezones()
    return cal.to_ical()


# ---------- mock WhatsApp ----------


def log_mock_whatsapp(outbox: Path, message: str, locale: str, label: str) -> dict[str, str]:
    outbox.parent.mkdir(parents=True, exist_ok=True)
    record = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "channel": "whatsapp", "status": "mocked", "locale": locale, "label": label, "message": message}
    with outbox.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"status": "mocked"}


# ---------- PDF ----------

FOOTER = (
    '<div style="width:100%;font:8px/10px Arial,sans-serif;color:#444;padding:0 16mm;display:flex;justify-content:space-between;gap:12px">'
    f"<span>{SAFETY_STATEMENT}</span>"
    '<span style="white-space:nowrap">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
)


def render_pdf(web_base_url: str, p: PassportPayload, chromium_path: str | None = None) -> bytes:
    """Open /passport/print in headless Chromium with the payload and print it. Chromium shapes and orders Arabic correctly."""
    from playwright.sync_api import sync_playwright

    data = {"passport": json.loads(p.model_dump_json()), "booking": {loc: booking_request(p, loc) for loc in LOCALES}}
    script = "window.__NB_PASSPORT__ = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium_path) if chromium_path else pw.chromium.launch()
        try:
            page = browser.new_context(locale="en-GB", timezone_id=p.timezone).new_page()
            page.add_init_script(script)
            page.goto(f"{web_base_url.rstrip('/')}/passport/print", wait_until="networkidle", timeout=30_000)
            page.wait_for_selector(PDF_READY_SELECTOR, timeout=20_000)
            page.evaluate("document.fonts.ready")
            page.emulate_media(media="print")
            return page.pdf(
                format="A4",
                print_background=True,
                prefer_css_page_size=False,
                display_header_footer=True,
                header_template="<span></span>",
                footer_template=FOOTER,
                margin={"top": "16mm", "bottom": "20mm", "left": "16mm", "right": "16mm"},
            )
        finally:
            browser.close()


def safe_filename(label: str, ext: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", f"nodulebridge-passport-{label}").strip("-").lower() + f".{ext}"
