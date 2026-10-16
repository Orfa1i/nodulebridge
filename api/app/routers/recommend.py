"""POST /recommend: Phase 4 extraction result (+ answers the user confirmed) -> Fleischner 2017 recommendation.

Deterministic: no model, no network. The same body gives the same answer on the same analysis date.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.rules.fleischner2017 import recommend

router = APIRouter()


class RecommendRequest(BaseModel):
    result: dict[str, Any] = Field(description="The `result` object returned by POST /extract.")
    risk_tier: Literal["low", "high", "unknown"] = "unknown"
    # answers the user confirms in the UI; the report's own statements are also used
    age_years: int | None = Field(default=None, ge=0, le=130)
    age_at_least_35: bool | None = None
    known_cancer: bool | None = None
    immunocompromised: bool | None = None
    is_screening_exam: bool | None = None
    study_date: date | None = None
    analysis_date: date | None = Field(default=None, description="Defaults to today; set it for reproducible output.")


def _merge(report: bool | None, user: bool | None) -> bool | None:
    """True if either source says True (it excludes the patient), else False if either says False."""
    if report is True or user is True:
        return True
    if report is False or user is False:
        return False
    return None


def _parse_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


@router.post("/recommend")
def post_recommend(body: RecommendRequest):
    result = body.result
    nodules = result.get("nodules")
    if not isinstance(nodules, list):
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "bad_request", "message": "The extraction result has no nodules list.", "detail": None}},
        )
    pc = result.get("patient_context") or {}
    study = result.get("study") or {}

    def reported(key: str) -> Any:
        item = pc.get(key)
        return item.get("value") if isinstance(item, dict) else None

    context = {
        "age_years": reported("age_years") if reported("age_years") is not None else body.age_years,
        "age_at_least_35": body.age_at_least_35,
        "known_cancer": _merge(reported("known_cancer"), body.known_cancer),
        "immunocompromised": _merge(reported("immunocompromised"), body.immunocompromised),
        "is_screening_exam": _merge(study.get("is_screening_exam"), body.is_screening_exam),
        "smoking_history": reported("smoking_history"),
        "risk_tier": body.risk_tier,
        "study_date": body.study_date or _parse_date(study.get("study_date")),
        "analysis_date": body.analysis_date,
    }
    return recommend(nodules, context)
