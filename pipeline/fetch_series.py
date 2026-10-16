"""Download ONLY the chosen LIDC-IDRI series from the public TCIA NBIA REST API.

Layout matches what pylidc expects: <root>/<patient>/<study_uid>/<series_uid>/*.dcm
No credentials are used or stored. Skips series that are already complete.

Usage: python -m pipeline.fetch_series
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import requests

HERE = Path(__file__).parent
RAW_ROOT = HERE.parent / "data" / "raw" / "LIDC-IDRI"
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1"


def fetch(patient_id: str, study_uid: str, series_uid: str) -> Path:
    dest = RAW_ROOT / patient_id / study_uid / series_uid
    meta = requests.get(f"{NBIA}/getSeriesMetaData", params={"SeriesInstanceUID": series_uid}, timeout=60)
    meta.raise_for_status()
    expected = int(meta.json()[0]["Number of Images"])
    if dest.exists() and len(list(dest.glob("*.dcm"))) == expected:
        print(f"{patient_id}: {expected} images already present")
        return dest
    print(f"{patient_id}: downloading {expected} images ...")
    resp = requests.get(f"{NBIA}/getImage", params={"SeriesInstanceUID": series_uid}, timeout=900)
    resp.raise_for_status()
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        for name in zf.namelist():
            if name.endswith(".dcm"):
                (dest / Path(name).name).write_bytes(zf.read(name))
    got = len(list(dest.glob("*.dcm")))
    if got != expected:
        raise RuntimeError(f"{patient_id}: expected {expected} images, got {got}")
    print(f"{patient_id}: ok, {got} images")
    return dest


def main() -> None:
    selection = json.loads((HERE / "selection.json").read_text())
    for case in selection.values():
        fetch(case["patient_id"], case["study_instance_uid"], case["series_instance_uid"])


if __name__ == "__main__":
    main()
