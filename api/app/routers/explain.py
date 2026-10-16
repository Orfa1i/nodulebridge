"""POST /explain (reviewed templates) and POST /tts (speech). Neither calls a language model."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Literal

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.explain import ContentError, explain
from app.services.ratelimit import too_many
from app.services.tts import TtsFailed, TtsProvider, TtsUnavailable, make_tts

router = APIRouter()


class ExplainRequest(BaseModel):
    recommendation: dict[str, Any] = Field(description="The body returned by POST /recommend.")
    finding: dict[str, Any] | None = Field(default=None, description="The driving nodule from POST /extract.")
    locale: Literal["en", "ar"]
    matched: bool | None = Field(default=None, description="False when the finding was not matched to an outlined nodule.")


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    locale: Literal["en", "ar"]


def _error(status: int, code: str, message: str, detail: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


@router.post("/explain")
def post_explain(body: ExplainRequest):
    rec = body.recommendation
    needed = {"applies", "rule_id", "options", "not_applicable_reasons", "questions_for_doctor", "notes", "size_mm"}
    if not needed <= rec.keys():
        return _error(422, "bad_request", "The recommendation is incomplete.", f"missing: {sorted(needed - rec.keys())}")
    try:
        return explain(rec, body.finding, body.locale, matched=body.matched)
    except ContentError as exc:
        return _error(500, "content_incomplete", "The explanation could not be prepared.", str(exc))


@lru_cache
def get_tts() -> TtsProvider:
    return make_tts(get_settings())


@router.post("/tts")
async def post_tts(body: TtsRequest, request: Request):
    settings = get_settings()
    limited = too_many(request, "tts", settings.rate_limit_tts_per_hour, settings.trust_proxy)
    if limited is not None:
        return limited
    try:
        tts = get_tts()
        audio = await anyio.to_thread.run_sync(tts.synthesize, body.text, body.locale)
    except TtsUnavailable as exc:
        return _error(503, "speech_unavailable", "The voice summary is not available.", str(exc))
    except TtsFailed as exc:
        return _error(502, "speech_failed", "The voice summary could not be made.", exc.detail or str(exc))
    return Response(
        content=audio.data,
        media_type="audio/mpeg",
        headers={
            "X-Audio-Duration": str(audio.duration_s),
            "X-Audio-Cached": str(audio.cached).lower(),
            "X-Audio-Voice": audio.voice,
            "X-Audio-Model": audio.model,
            "X-Audio-Text-Sha256": audio.text_sha256,
            "Access-Control-Expose-Headers": "X-Audio-Duration, X-Audio-Cached, X-Audio-Voice, X-Audio-Model, X-Audio-Text-Sha256",
        },
    )
