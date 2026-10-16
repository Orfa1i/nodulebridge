"""Pre-computed extractions of the three example reports, shipped with the API.

A fresh deployment has an empty cache, so the first click on an example would call the model. The files in
api/seed/extract/ are real model outputs for the example reports (Cases A to C, written by the team, no patient data),
named by the same hash the cache uses (report text + prompt version + model id). On startup they are copied into the
cache folder if missing. If the deployed model or prompt differs from the one that made them, the keys do not match and
nothing is used: the model is called, never a stale answer. The UI labels a cache hit "Pre-computed for demo".

Make them with: uv run --project api python -m api.scripts.export_seed
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.config import ROOT, Settings

SEED_DIR = ROOT / "api" / "seed" / "extract"


def seed_extract_cache(settings: Settings, seed_dir: Path = SEED_DIR) -> int:
    """Copy missing seed files into the cache. Returns how many were copied."""
    if not seed_dir.is_dir():
        return 0
    target = settings.data_dir / "cache" / "extract"
    copied = 0
    for src in sorted(seed_dir.glob("*.json")):
        dst = target / src.name
        if dst.exists():
            continue
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        copied += 1
    return copied
