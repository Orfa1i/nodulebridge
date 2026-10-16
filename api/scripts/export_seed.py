"""Copy the cached extractions of the example reports (every prepared case) into api/seed/extract/ so they ship with the API.

Usage (repo root): uv run --project api python -m api.scripts.export_seed

It only copies entries that already exist in the cache for the CURRENT model and prompt version, and it checks that
each entry holds an extraction (no error, no empty result). Open each example once in the app (or run `pnpm warm`)
first so the cache is filled by the real model. It never calls a model.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services.cache import cache_key
from app.services.extractor import PROMPT_VERSION
from app.services.providers import model_id
from app.services.report_text import read_pdf
from app.services.seed import SEED_DIR

from .case_content import all_case_letters, case_dir


def main() -> int:
    settings = get_settings()
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    missing = 0
    for letter in all_case_letters():
        report = read_pdf((case_dir(letter) / "report.pdf").read_bytes())
        key = cache_key(report.normalised, PROMPT_VERSION, model_id(settings))
        src = settings.data_dir / "cache" / "extract" / f"{key}.json"
        if not src.exists():
            print(f"case {letter}: no cached extraction for {model_id(settings)} / {PROMPT_VERSION}. Open the example once first.")
            missing += 1
            continue
        entry = json.loads(src.read_text(encoding="utf-8"))
        if not entry.get("llm_result", {}).get("nodules"):
            print(f"case {letter}: the cached entry has no nodules; not exported.")
            missing += 1
            continue
        shutil.copyfile(src, SEED_DIR / src.name)
        print(f"case {letter}: exported {src.name[:12]}... ({entry['model']}, {entry['prompt_version']})")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
