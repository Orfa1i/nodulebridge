"""Read every prepared example report once with the real model, so the extractions are cached and can be shipped as seeds.

Usage (repo root): uv run --project api python -m api.scripts.extract_all [--only D,E] [--pause 6]

Cases whose extraction is already cached for the current model and prompt are skipped (no model call). Each live call is
checked: the result must hold exactly one finding that survived verification, otherwise the case is reported (not hidden)
so the scenario or the report can be fixed. Free tiers rate limit: --pause spaces the calls. Then run export_seed.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services.extract_service import ExtractService
from app.services.providers import make_extractor
from app.services.report_text import read_pdf

from .case_content import all_case_letters, case_dir


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma separated letters")
    ap.add_argument("--pause", type=float, default=6.0)
    args = ap.parse_args()
    settings = get_settings()
    service = ExtractService(settings, lambda: make_extractor(settings))
    letters = [x.strip().lower() for x in args.only.split(",")] if args.only else all_case_letters()
    problems = 0
    for letter in letters:
        report = read_pdf((case_dir(letter) / "report.pdf").read_bytes())
        was_cached = service.is_cached(report)
        try:
            out = service.run(report, 0.0)
        except Exception as exc:  # noqa: BLE001 - report every failure, keep going
            print(f"case {letter}: FAILED {type(exc).__name__}: {str(exc)[:200]}")
            problems += 1
            continue
        nodules = out["result"]["nodules"]
        v = out["verification"]
        flag = "" if len(nodules) == 1 and nodules[0]["confidence"] == "checked" else "  <-- CHECK"
        problems += 1 if flag else 0
        n = nodules[0] if nodules else {}
        print(f"case {letter}: {'cached' if was_cached else 'LIVE'} · {len(nodules)} nodule(s) · quotes dropped {v['quotes_dropped']} · {n.get('mean_diameter_mm')} mm {n.get('attenuation')} {n.get('side')} {n.get('lobe')}{flag}")
        if not was_cached:
            time.sleep(args.pause)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
