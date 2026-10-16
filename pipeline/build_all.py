"""Rebuild all demo cases from the downloaded DICOM.

Usage (from repo root): python -m pipeline.build_all
Needs data/raw/LIDC-IDRI (run `python -m pipeline.fetch_series` first) and a pylidc config
pointing at it (~/pylidc.conf on Windows, ~/.pylidcrc elsewhere); the config is created if missing.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from .build_case import CASES_DIR, ROOT, build_case

RAW = ROOT / "data" / "raw" / "LIDC-IDRI"


def ensure_pylidc_config() -> None:
    name = "pylidc.conf" if sys.platform.startswith("win") else ".pylidcrc"
    conf = Path.home() / name
    if not conf.exists():
        conf.write_text(f"[dicom]\npath = {RAW.as_posix()}\nwarn = True\n", encoding="utf-8")
        print(f"created {conf}")


def main() -> None:
    ensure_pylidc_config()
    selection = json.loads((Path(__file__).parent / "selection.json").read_text())
    t0 = time.time()
    for letter, sel in selection.items():
        t = time.time()
        m = build_case(letter, sel)
        n = m["nodules"][0]
        print(
            f"{m['case_id']} {m['lidc_patient_id']}: slice {n['slice_index']}/{m['geometry']['slice_count']}"
            f" size {n['fleischner_size_mm']} mm ({n['long_axis_mm']} x {n['short_axis_mm']}),"
            f" {n['attenuation']}, {n['lobe_estimate']['label']}, {m['export']['total_mb']} MB,"
            f" {time.time() - t:.0f}s"
        )
    print(f"cases written to {CASES_DIR} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
