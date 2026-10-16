"""Referral passport endpoints. Deterministic: no language model is called (see services/passport.py)."""

from __future__ import annotations

import json
from typing import Literal

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services import passport as svc
from app.services.explain import ContentError
from app.services.ratelimit import too_many

router = APIRouter()
Locale = Literal["en", "ar"]


def _error(status: int, code: str, message: str, detail: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


class BookingBody(BaseModel):
    passport: svc.PassportPayload
    locale: Locale


class IcsBody(BookingBody):
    caregiver: bool = False


class WhatsAppBody(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    locale: Locale
    label: str = Field(default="", max_length=80)


class FhirBody(BaseModel):
    passport: svc.PassportPayload


class PdfBody(BaseModel):
    passport: svc.PassportPayload


@router.post("/passport/booking")
def post_booking(body: BookingBody):
    try:
        return svc.booking_request(body.passport, body.locale)
    except ContentError as exc:
        return _error(500, "content_incomplete", "The booking request could not be prepared.", str(exc))


@router.post("/passport/fhir")
def post_fhir(body: FhirBody):
    try:
        bundle = svc.fhir_bundle(body.passport)
    except ValueError as exc:  # fhir.resources validation
        return _error(500, "fhir_invalid", "The FHIR summary did not pass validation.", str(exc)[:600])
    return Response(
        content=json.dumps(bundle, ensure_ascii=False, indent=2),
        media_type="application/fhir+json",
        headers={"Content-Disposition": f'attachment; filename="{svc.safe_filename(body.passport.label, "fhir.json")}"'},
    )


@router.post("/passport/ics")
def post_ics(body: IcsBody):
    try:
        data = svc.ics_file(body.passport, body.locale, body.caregiver)
    except ContentError as exc:
        return _error(500, "content_incomplete", "The calendar file could not be prepared.", str(exc))
    suffix = "caregiver.ics" if body.caregiver else "reminders.ics"
    return Response(content=data, media_type="text/calendar", headers={"Content-Disposition": f'attachment; filename="{svc.safe_filename(body.passport.label, suffix)}"'})


@router.post("/passport/pdf")
async def post_pdf(body: PdfBody, request: Request):
    settings = get_settings()
    limited = too_many(request, "pdf", settings.rate_limit_pdf_per_hour, settings.trust_proxy)
    if limited is not None:
        return limited
    try:
        pdf = await anyio.to_thread.run_sync(svc.render_pdf, settings.web_base_url, body.passport, settings.chromium_path, settings.chromium_no_sandbox)
    except Exception as exc:  # noqa: BLE001 - Chromium missing, web app down, timeout: report plainly; the UI offers browser print
        return _error(
            502,
            "pdf_unavailable",
            "The PDF could not be made on the server. Use Print and choose Save as PDF instead.",
            f"{type(exc).__name__}: {str(exc)[:400]}",
        )
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{svc.safe_filename(body.passport.label, "pdf")}"'})


@router.post("/mock/whatsapp")
def post_mock_whatsapp(body: WhatsAppBody):
    """Writes the message to data/mock-outbox.jsonl. Nothing is sent: no messaging API is ever called in this build."""
    return svc.log_mock_whatsapp(get_settings().data_dir / "mock-outbox.jsonl", body.message, body.locale, body.label)
