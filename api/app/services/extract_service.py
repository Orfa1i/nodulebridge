"""Orchestrates intake -> (cache | LLM) -> deterministic verification."""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime

from app.config import Settings

from .cache import ExtractCache, cache_key
from .extractor import PROMPT_VERSION, Extractor
from .providers import model_id
from .report_text import ReportText
from .verify_extraction import verify


class ExtractService:
    def __init__(self, settings: Settings, extractor_factory: Callable[[], Extractor]):
        self.settings = settings
        self._factory = extractor_factory
        self._extractor: Extractor | None = None
        self.cache = ExtractCache(settings.data_dir / "cache" / "extract")

    def run(self, report: ReportText, intake_ms: float, started: float | None = None) -> dict:
        t0 = started if started is not None else time.monotonic()
        deadline = t0 + self.settings.extract_timeout_s
        key = cache_key(report.normalised, PROMPT_VERSION, model_id(self.settings))

        llm_ms = 0.0
        entry = self.cache.get(key)
        cached = entry is not None
        if entry is None:
            if self._extractor is None:
                self._extractor = self._factory()  # may raise ExtractionUnavailable
            t = time.monotonic()
            output = self._extractor.extract(report.sentences, deadline)
            llm_ms = (time.monotonic() - t) * 1000
            entry = {
                "created": datetime.now(UTC).isoformat(),
                "prompt_version": PROMPT_VERSION,
                "model": output.model,
                "llm_result": output.result,
                "request_id": output.request_id,
                "usage": output.usage,
            }
            self.cache.put(key, entry)

        t = time.monotonic()
        verified, summary = verify(entry["llm_result"], report.sentences)
        verify_ms = (time.monotonic() - t) * 1000
        return {
            "sentences": [s.as_dict() for s in report.sentences],
            "result": verified,
            "verification": summary.as_dict(),
            "timings": {
                "intake_ms": round(intake_ms, 1),
                "llm_ms": round(llm_ms, 1),
                "verify_ms": round(verify_ms, 1),
                "total_ms": round((time.monotonic() - t0) * 1000, 1),
            },
            "prompt_version": PROMPT_VERSION,
            "model": entry["model"],
            "cached": cached,
        }
