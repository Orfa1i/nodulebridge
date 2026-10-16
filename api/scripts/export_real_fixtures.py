"""Write the REAL model extractions of every prepared report (from the cache, never calling a model) as test fixtures.

Usage (repo root): uv run --project api python -m api.scripts.export_real_fixtures

These files are verified /extract responses made by the real model (see model and prompt_version inside). The web unit
tests use them to check that every report finding is linked to its own scan outline and to no other scan. Run
`python -m api.scripts.extract_all` first so the cache holds them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import ROOT, get_settings
from app.services.extract_service import ExtractService
from app.services.report_text import read_pdf

from .case_content import all_case_letters, case_dir

OUT = ROOT / "web" / "tests" / "fixtures" / "real"


def main() -> int:
    settings = get_settings()
    OUT.mkdir(parents=True, exist_ok=True)

    def refuse():
        raise RuntimeError("cold cache: this script never calls a model")

    service = ExtractService(settings, refuse)
    missing = 0
    for letter in all_case_letters():
        report = read_pdf((case_dir(letter) / "report.pdf").read_bytes())
        if not service.is_cached(report):
            print(f"case {letter}: not cached, run extract_all first")
            missing += 1
            continue
        payload = service.run(report, 0.0)
        payload["timings"] = {"intake_ms": 0, "llm_ms": 0, "verify_ms": 0, "total_ms": 0}  # keep the files stable
        (OUT / f"extract-case-{letter}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote extract-case-{letter}.json ({payload['model']}, {payload['prompt_version']})")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
