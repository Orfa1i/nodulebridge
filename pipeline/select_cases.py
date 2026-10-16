"""Pick demo cases A, B, C from LIDC-IDRI using pylidc's bundled annotation metadata.

No images are needed here. Rules follow docs/build/02-lidc-case-preparation.md, tightened by
the team: the scan must have no other nodule cluster >= 3 mm marked by 2+ radiologists, so a
report can honestly say "single nodule". Lobe position and measured size are re-checked after
download (build_all), because pylidc's diameter is the longest in-plane width, not the
Fleischner mean of long and short axis.

Usage: python -m pipeline.select_cases [--write]
"""

from __future__ import annotations

import argparse
import json
import statistics
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path

warnings.filterwarnings("ignore")
import pylidc as pl  # noqa: E402

SELECTION_FILE = Path(__file__).with_name("selection.json")
MAX_SLICE_THICKNESS_MM = 2.5


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
    mean_diameter_mm: float
    mean_contour_z_mm: float
    target_gap: float
    note: str = ""


def clusters_of(scan):
    out = []
    for ann_list in scan.cluster_annotations():
        if not ann_list:
            continue
        out.append(
            {
                "n": len(ann_list),
                "tex": [a.texture for a in ann_list],
                "diam": statistics.mean(a.diameter for a in ann_list),
                "z": statistics.mean(statistics.mean(a.contour_slice_zvals) for a in ann_list),
            }
        )
    return out


def single_nodule(clusters, main) -> bool:
    """No other cluster >= 3 mm marked by 2+ radiologists."""
    return all(c is main or not (c["n"] >= 2 and c["diam"] >= 3.0) for c in clusters)


def candidates(min_raters: int = 3, patients: list[str] | None = None) -> dict[str, list[Candidate]]:
    rules = {
        # case: (texture test, diameter range, target diameter)
        "A": (lambda m: m >= 4, (8.5, 10.0), 9.0),
        "B": (lambda m: m >= 4, (6.0, 8.0), 7.0),
        "C": (lambda m: m <= 2, (6.0, 100.0), 8.0),
    }
    found: dict[str, list[Candidate]] = {k: [] for k in rules}
    query = pl.query(pl.Scan).filter(pl.Scan.slice_thickness <= MAX_SLICE_THICKNESS_MM)
    if patients:
        query = query.filter(pl.Scan.patient_id.in_(patients))
    for scan in query:
        clusters = clusters_of(scan)
        for main in clusters:
            if main["n"] < min_raters:
                continue
            med = statistics.median(main["tex"])
            if not single_nodule(clusters, main):
                continue
            for case, (tex_ok, (lo, hi), target) in rules.items():
                if tex_ok(med) and lo <= main["diam"] <= hi:
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
                            mean_diameter_mm=round(main["diam"], 2),
                            mean_contour_z_mm=round(main["z"], 1),
                            target_gap=round(abs(main["diam"] - target), 2),
                        )
                    )
    for lst in found.values():
        # agreeing raters first, then closest to the intended size
        lst.sort(key=lambda c: (c.texture_range, c.target_gap, -c.raters, c.patient_id))
    return found


def print_table(found: dict[str, list[Candidate]], limit: int = 12) -> None:
    for case, lst in found.items():
        print(f"\nCase {case}: {len(lst)} candidates (showing top {min(limit, len(lst))})")
        print(
            f"{'patient':16} {'thick':>5} {'raters':>6} {'med_tex':>7} {'tex_rng':>7} "
            f"{'diam_mm':>7} {'z_mm':>8}"
        )
        for c in lst[:limit]:
            print(
                f"{c.patient_id:16} {c.slice_thickness:5.2f} {c.raters:6d} {c.median_texture:7.1f} "
                f"{c.texture_range:7d} {c.mean_diameter_mm:7.2f} {c.mean_contour_z_mm:8.1f}"
            )


def pick(found: dict[str, list[Candidate]]) -> dict[str, Candidate]:
    chosen: dict[str, Candidate] = {}
    used: set[str] = set()
    for case in ("A", "B", "C"):
        for c in found[case]:
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
    args = ap.parse_args()
    found = candidates(args.min_raters, args.patients)
    print_table(found)
    chosen = pick(found)
    print("\nChosen (first ranked, distinct patients):")
    for case, c in chosen.items():
        print(f"  {case}: {c.patient_id} diam~{c.mean_diameter_mm} mm tex={c.median_texture} "
              f"raters={c.raters} series={c.series_instance_uid}")
    if args.write:
        SELECTION_FILE.write_text(
            json.dumps({k: asdict(v) for k, v in chosen.items()}, indent=2) + "\n"
        )
        print(f"wrote {SELECTION_FILE.name}")


if __name__ == "__main__":
    main()
