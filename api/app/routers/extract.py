from __future__ import annotations

import asyncio
import time
from functools import lru_cache

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.services.extract_service import ExtractService
from app.services.extractor import ExtractionFailed, ExtractionUnavailable
from app.services.providers import make_extractor
from app.services.ratelimit import too_many
from app.services.report_text import ReportReadError, read_pdf, read_text

router = APIRouter()
READ_ERROR = "The report could not be read. Paste the text instead."


@lru_cache
def get_service() -> ExtractService:
    settings = get_settings()
    return ExtractService(settings, lambda: make_extractor(settings))


def _error(status: int, code: str, message: str, detail: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


async def _intake(request: Request):
    """Return (ReportText, intake_ms). Raises ReportReadError."""
    t = time.monotonic()
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ReportReadError("No file was sent. Send a PDF in the field 'file'.")
        data = await upload.read()
        report = await anyio.to_thread.run_sync(read_pdf, data)
    elif content_type.startswith("application/json"):
        try:
            body = await request.json()
        except ValueError as exc:
            raise ReportReadError("The request body is not valid JSON.") from exc
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str):
            raise ReportReadError("Send JSON of the form {\"text\": \"...\"}.")
        report = read_text(text)
    else:
        raise ReportReadError("Send a PDF as multipart/form-data or JSON {\"text\": ...}.")
    return report, (time.monotonic() - t) * 1000


@router.post("/extract")
async def extract(request: Request):
    settings = get_settings()
    started = time.monotonic()
    try:
        report, intake_ms = await _intake(request)
    except ReportReadError as exc:
        return _error(422, "report_unreadable", READ_ERROR, str(exc))
    service = get_service()
    if not service.is_cached(report):  # only a call that reaches the model costs anything
        limited = too_many(request, "extract", settings.rate_limit_extract_per_hour, settings.trust_proxy)
        if limited is not None:
            return limited
    try:
        payload = await asyncio.wait_for(
            anyio.to_thread.run_sync(lambda: service.run(report, intake_ms, started)),
            timeout=settings.extract_timeout_s,
        )
    except ExtractionUnavailable as exc:
        return _error(503, "ai_unavailable", "The AI service is not available.", str(exc))
    except ExtractionFailed as exc:
        return _error(502, "extraction_failed", READ_ERROR, exc.detail or str(exc))
    except TimeoutError:
        return _error(504, "timeout", READ_ERROR, f"The {settings.extract_timeout_s:g} second limit was reached.")
    return payload
