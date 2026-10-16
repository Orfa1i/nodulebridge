"""Shared by make_voices and check_content: the patient explanation of Cases A to C, from the real pipeline.

The extraction comes from the cache (it was read by the real model once and is verified every time); nothing here
calls a language model unless the cache is cold and a key is set. The guideline step and the explanation are
deterministic. The analysis date is fixed because it only changes written dates, never the spoken text.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT, get_settings
from app.routers.recommend import RecommendRequest, post_recommend
from app.services.explain import Content, explain
from app.services.extract_service import ExtractService
from app.services.providers import make_extractor
from app.services.report_text import read_pdf

CASES = ("a", "b", "c")
ANALYSIS_DATE = date(2026, 10, 16)


def case_dir(letter: str) -> Path:
    return ROOT / "data" / "cases" / f"case-{letter}"


def case_explanation(letter: str, locale: str, content: Content | None = None) -> dict[str, Any]:
    settings = get_settings()
    service = ExtractService(settings, lambda: make_extractor(settings))
    report = read_pdf((case_dir(letter) / "report.pdf").read_bytes())
    payload = service.run(report, 0.0)
    result = payload["result"]
    rec = post_recommend(RecommendRequest(result=result, analysis_date=ANALYSIS_DATE))
    if not isinstance(rec, dict):
        raise TypeError(f"recommendation failed for case {letter}")
    finding = next((n for n in result["nodules"] if n["id"] == rec["driving_nodule_id"]), None)
    out = explain(rec, finding, locale, matched=True, content=content)
    out["recommendation"] = rec
    out["extraction_cached"] = payload["cached"]
    return out


def case_passport(letter: str, content: Content | None = None) -> dict[str, Any]:
    """The passport payload of a prepared case, as the browser would build it (no picture)."""
    data = case_explanation(letter, "en", content)
    explanation = {loc: case_explanation(letter, loc, content) for loc in ("en", "ar")}
    rec = data["recommendation"]
    settings = get_settings()
    service = ExtractService(settings, lambda: make_extractor(settings))
    report = read_pdf((case_dir(letter) / "report.pdf").read_bytes())
    result = service.run(report, 0.0)["result"]
    finding = next((n for n in result["nodules"] if n["id"] == rec["driving_nodule_id"]), None)
    return {
        "label": f"Example patient {letter.upper()}",
        "case_id": f"case-{letter}",
        "report_text": report.normalised,
        "evidence_quote": finding["evidence"][0]["quote"] if finding else None,
        "finding": finding,
        "recommendation": rec,
        "explanation": explanation,
    }
