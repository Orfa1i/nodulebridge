"""Disk cache for raw LLM extractions. Verification is NOT cached: it is cheap and always re-run."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def cache_key(normalised_text: str, prompt_version: str, model: str) -> str:
    h = hashlib.sha256()
    for part in (normalised_text, prompt_version, model):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


class ExtractCache:
    def __init__(self, folder: Path):
        self.folder = folder

    def _path(self, key: str) -> Path:
        return self.folder / f"{key}.json"

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def put(self, key: str, entry: dict) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = self._path(key).with_suffix(".tmp")
        tmp.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path(key))
