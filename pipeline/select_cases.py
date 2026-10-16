"""Pick demo cases A, B, C from LIDC-IDRI using pylidc's bundled annotation metadata.

No images are needed here. Rules follow docs/build/02-lidc-case-preparation.md, tightened by
the team: the scan must have no other nodule cluster >= 3 mm marked by 2+ radiologists, so a
report can honestly say "single nodule". Sizes are MEASURED the same way the build measures
them (50% consensus mask, Fleischner mean of long and short axis), not taken from pylidc's
`diameter`, which is the longest in-plane width.

Case A also needs the nodule in the upper third of the lung. Lung extent needs the images, so
here we only estimate the nodule's height in the scan (from contour z positions and the series
image count) and re-check the real lung fraction after download in build_all.

Usage: python -m pipeline.select_cases [--patients ID ...] [--write]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import requests

warnings.filterwarnings("ignore")
import pylidc as pl
from pylidc.utils import consensus

from .measure import feret_axes

SELECTION_FILE = Path(__file__).with_name("selection.json")
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1"
MAX_SLICE_THICKNESS_MM = 2.5
MAX_IMAGES_B_C = 300  # keeps exports near the 60 MB per-case target
MIN_SCAN_FRACTION_A = 0.55  # estimated nodule height in the scan; real lung fraction checked later


@dataclass
class Candidate:
    case: str
    patient_id: str
    series_instance_uid: str
    study_instance_uid: str
    slice_thickness: float
    raters: int
    median_texture: float
    texture_range: int
    long_axis_mm: float
    short_axis_mm: float
    mean_diameter_mm: float
    scan_z_fraction: float
    n_images: int
    contrast_used: bool
    target_gap: float
    note: str = ""


_n_images_cache: dict[str, int] = {}


NBIA_CACHE = Path(__file__).resolve().parent.parent / "data" / "raw" / "nbia_image_counts.json"


def _load_counts() -> None:
    if not _n_images_cache and NBIA_CACHE.exists():
        _n_images_cache.update(json.loads(NBIA_CACHE.read_text()))


def n_images(series_uid: str) -> int:
    """Number of images in a series from the TCIA metadata service. Retried (the service resets connections now and
    then) and cached on disk, so a rerun does not ask again."""
    _load_counts()
    if series_uid not in _n_images_cache:
        last: Exception | None = None
        for attempt in range(1, 7):
            try:
                r = requests.get(f"{NBIA}/getSeriesMetaData", params={"SeriesInstanceUID": series_uid}, timeout=60)
                r.raise_for_status()
                _n_images_cache[series_uid] = int(r.json()[0]["Number of Images"])
                NBIA_CACHE.parent.mkdir(parents=True, exist_ok=True)
                NBIA_CACHE.write_text(json.dumps(_n_images_cache))
                break
            except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
                last = exc
                time.sleep(2 * attempt)
        else:
            raise RuntimeError(f"TCIA metadata for {series_uid} unavailable after 6 tries: {last}")
    return _n_images_cache[series_uid]


def measure_cluster(scan, ann_list) -> tuple[float, float]:
    pad = [(5, 5), (5, 5), (2, 2)]
    cmask, _, _ = consensus(ann_list, clevel=0.5, pad=pad)
    k = int(np.argmax(cmask.sum(axis=(0, 1))))
    sp = float(scan.pixel_spacing)
    return feret_axes(cmask[:, :, k], sp, sp)


def scan_fraction(ann_list, count: int) -> float:
    """Estimated height of the nodule within the scan (0 = first slice, 1 = last), by slice index.

    Slice index runs in ascending z, so this is a monotone proxy for height; the real lung
    fraction is re-checked after download.
    """
    ks = [c.image_k_position for a in ann_list for c in a.contours]
    return float(np.mean(ks) / (count - 1)) if ks and count > 1 else float("nan")


def clusters_of(scan):
    out = []
    for ann_list in scan.cluster_annotations():
        if not ann_list:
            continue
        out.append(
            {
                "anns": ann_list,
                "n": len(ann_list),
                "tex": [a.texture for a in ann_list],
                "diam": statistics.mean(a.diameter for a in ann_list),
            }
        )
    return out


def single_nodule(clusters, main) -> bool:
    """No other cluster >= 3 mm marked by 2+ radiologists."""
    return all(c is main or not (c["n"] >= 2 and c["diam"] >= 3.0) for c in clusters)


SOLID = lambda m: m >= 4
GROUND_GLASS = lambda m: m <= 2
PART_SOLID = lambda m: 2 < m < 4

# case letter: (texture test, measured mean diameter range in mm, target size, needs a contrast scan).
# A to C are the original three. D to T fill the worklist with a spread of sizes and types; R, S and T are the
# "guideline does not apply" examples (their report scenarios say age 30, a screening scan, a known cancer), so
# any single nodule will do for them. Sizes are the build's own measurement (50% consensus mask, Fleischner mean).
RULES = {
    "A": (SOLID, (8.5, 10.0), 9.0, False),
    "B": (SOLID, (6.0, 8.0), 7.0, True),
    "C": (GROUND_GLASS, (6.0, 100.0), 8.0, False),
    "D": (SOLID, (3.5, 5.4), 4.5, False),
    "E": (SOLID, (3.5, 5.4), 5.0, False),
    "F": (SOLID, (6.0, 8.0), 7.5, True),  # CT pulmonary angiogram scenario: needs contrast
    "G": (SOLID, (8.0, 11.0), 10.0, False),
    "H": (SOLID, (11.0, 16.0), 13.0, False),
    "I": (SOLID, (16.0, 26.0), 20.0, False),
    "J": (GROUND_GLASS, (3.5, 5.4), 5.0, False),
    "K": (GROUND_GLASS, (6.0, 9.0), 7.5, False),
    "L": (GROUND_GLASS, (9.5, 14.0), 11.0, False),
    "M": (PART_SOLID, (6.0, 9.0), 7.5, False),
    "N": (PART_SOLID, (9.0, 15.0), 12.0, False),
    "O": (SOLID, (6.0, 8.0), 6.5, True),  # CT pulmonary angiogram scenario
    "P": (SOLID, (8.0, 10.0), 8.5, False),
    "Q": (GROUND_GLASS, (15.0, 30.0), 18.0, False),
    "R": (SOLID, (6.0, 9.0), 7.0, False),
    "S": (SOLID, (6.0, 10.0), 8.0, False),
    "T": (SOLID, (8.0, 14.0), 10.0, False),
}
# how far apart the radiologists' texture ratings may be for the extra cases (default 1). Part-solid and small or
# medium ground-glass nodules are rarely rated alike by every reader, so those four slots allow 2; the build still
# records the ratings and flags the type as uncertain when they differ by more than 2.
TEXTURE_SPREAD = {"J": 2, "K": 2, "M": 2, "N": 2}
ORIGINAL = ("A", "B", "C")
EXTRA = tuple(k for k in RULES if k not in ORIGINAL)


def candidates(min_raters: int = 3, patients: list[str] | None = None, letters: tuple[str, ...] | None = None) -> dict[str, list[Candidate]]:
    rules = {k: v for k, v in RULES.items() if letters is None or k in letters}
    found: dict[str, list[Candidate]] = {k: [] for k in rules}
    query = pl.query(pl.Scan).filter(pl.Scan.slice_thickness <= MAX_SLICE_THICKNESS_MM)
    if patients:
        query = query.filter(pl.Scan.patient_id.in_(patients))
    for done, scan in enumerate(query, start=1):
        if done % 50 == 0:
            print(f"  scanned {done} scans", file=sys.stderr, flush=True)
        clusters = clusters_of(scan)
        for main in clusters:
            if main["n"] < min_raters or not single_nodule(clusters, main):
                continue
            med = statistics.median(main["tex"])
            wanted = [c for c, (ok, *_rest) in rules.items() if ok(med)]
            if not wanted:
                continue
            try:
                long_a, short_a = measure_cluster(scan, main["anns"])
            except (ValueError, IndexError) as exc:  # degenerate mask: log and skip
                print(f"skip {scan.patient_id}: {exc}")
                continue
            mean_d = (long_a + short_a) / 2
            for case in wanted:
                _, (lo, hi), target, needs_contrast = rules[case]
                if not lo <= mean_d <= hi:
                    continue
                if case in EXTRA and max(main["tex"]) - min(main["tex"]) > TEXTURE_SPREAD.get(case, 1):
                    continue  # the extra cases need the radiologists to agree on the type
                count = n_images(scan.series_instance_uid)
                frac = scan_fraction(main["anns"], count)
                if case != "A" and count > MAX_IMAGES_B_C:
                    continue
                if needs_contrast and not scan.contrast_used:
                    continue  # scenario is a CT pulmonary angiogram: needs a contrast-enhanced scan
                if case == "A" and not frac >= MIN_SCAN_FRACTION_A:
                    continue
                found[case].append(
                    Candidate(
                        case=case,
                        patient_id=scan.patient_id,
                        series_instance_uid=scan.series_instance_uid,
                        study_instance_uid=scan.study_instance_uid,
                        slice_thickness=float(scan.slice_thickness),
                        raters=main["n"],
                        median_texture=med,
                        texture_range=max(main["tex"]) - min(main["tex"]),
                        long_axis_mm=round(long_a, 1),
                        short_axis_mm=round(short_a, 1),
                        mean_diameter_mm=round(mean_d, 2),
                        scan_z_fraction=round(frac, 2),
                        n_images=count,
                        contrast_used=bool(scan.contrast_used),
                        target_gap=round(abs(mean_d - target), 2),
                    )
                )
    for case, lst in found.items():
        # strongest rater agreement on texture first, then closest to the intended size
        lst.sort(key=lambda c: (c.texture_range, c.target_gap, -c.scan_z_fraction, c.patient_id))
    return found


def print_table(found: dict[str, list[Candidate]], limit: int = 12) -> None:
    for case, lst in found.items():
        print(f"\nCase {case}: {len(lst)} candidates (showing top {min(limit, len(lst))})")
        print(
            f"{'patient':16} {'thick':>5} {'raters':>6} {'tex':>4} {'rng':>3} {'long':>5} "
            f"{'short':>5} {'mean':>5} {'zfrac':>5} {'imgs':>4} {'ctrst':>5}"
        )
        for c in lst[:limit]:
            print(
                f"{c.patient_id:16} {c.slice_thickness:5.2f} {c.raters:6d} {c.median_texture:4.1f} "
                f"{c.texture_range:3d} {c.long_axis_mm:5.1f} {c.short_axis_mm:5.1f} "
                f"{c.mean_diameter_mm:5.2f} {c.scan_z_fraction:5.2f} {c.n_images:4d} {c.contrast_used!s:>5}"
            )


def pick(found: dict[str, list[Candidate]], skip: set[str] | None = None) -> dict[str, Candidate]:
    chosen: dict[str, Candidate] = {}
    used: set[str] = set(skip or ())
    for case, options in found.items():
        for c in options:
            if c.patient_id not in used:
                chosen[case] = c
                used.add(c.patient_id)
                break
    return chosen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write selection.json")
    ap.add_argument("--min-raters", type=int, default=3)
    ap.add_argument("--patients", nargs="*", help="restrict to these LIDC patient ids (fast)")
    ap.add_argument("--limit", type=int, default=12)
    ap.add_argument("--skip", nargs="*", default=[], help="patient ids rejected after download")
    ap.add_argument("--extend", action="store_true", help="add the extra cases D to T and keep A to C exactly as they are in selection.json")
    args = ap.parse_args()
    existing = json.loads(SELECTION_FILE.read_text()) if SELECTION_FILE.exists() else {}
    letters = tuple(k for k in EXTRA if k not in existing) if args.extend else ORIGINAL
    found = candidates(args.min_raters, args.patients, letters)
    print_table(found, args.limit)
    taken = {v["patient_id"] for v in existing.values()} if args.extend else set()
    chosen = pick(found, set(args.skip) | taken)
    print("\nChosen (first ranked, distinct patients):")
    for case, c in chosen.items():
        print(
            f"  {case}: {c.patient_id} mean={c.mean_diameter_mm} mm tex={c.median_texture} "
            f"raters={c.raters} images={c.n_images} series={c.series_instance_uid}"
        )
    if args.write:
        merged = {**existing, **{k: asdict(v) for k, v in chosen.items()}} if args.extend else {k: asdict(v) for k, v in chosen.items()}
        SELECTION_FILE.write_text(json.dumps(merged, indent=2) + "\n")
        print(f"wrote {SELECTION_FILE.name}")


if __name__ == "__main__":
    main()
