"""POST /redact: the first half of reading an uploaded report. No language model is called here.

The browser sends the report (a PDF in the field 'file', or JSON {"text": ...}); the answer is the text with
identifying patterns replaced by [redacted], plus a count per kind, so the person can see what would be removed before
anything goes to the model. Pattern matching is not complete (see services/redact.py); the UI says so.
"""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.services.redact import redact
from app.services.report_text import ReportReadError, pdf_to_text

router = APIRouter()
MAX_TEXT_CHARS = 60_000


def _error(status: int, code: str, message: str, detail: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


@router.post("/redact")
async def post_redact(request: Request):
    content_type = request.headers.get("content-type", "")
    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                raise ReportReadError("No file was sent. Send a PDF in the field 'file'.")
            text, _ = await anyio.to_thread.run_sync(pdf_to_text, await upload.read())
        elif content_type.startswith("application/json"):
            body = await request.json()
            text = body.get("text") if isinstance(body, dict) else None
            if not isinstance(text, str):
                raise ReportReadError('Send JSON of the form {"text": "..."}.')
        else:
            raise ReportReadError('Send a PDF as multipart/form-data or JSON {"text": ...}.')
    except ReportReadError as exc:
        return _error(422, "report_unreadable", "The report could not be read. Paste the text instead.", str(exc))
    except ValueError:
        return _error(422, "report_unreadable", "The report could not be read. Paste the text instead.", "The request body is not valid JSON.")
    if not text.strip():
        return _error(422, "report_unreadable", "The report could not be read. Paste the text instead.", "The report text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        return _error(422, "report_too_long", "The report is too long.", f"Limit is {MAX_TEXT_CHARS} characters.")
    return redact(text).as_json()
