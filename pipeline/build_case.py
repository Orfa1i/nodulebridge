"""Build one demo case end to end: mask, measurements, export, report, manifest."""

from __future__ import annotations

import json
import statistics
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
import pylidc as pl
from jsonschema import Draft202012Validator
from pylidc.utils import consensus

from . import reports
from .export import export_pair
from .measure import lobe_estimate, measure_nodule
from .select_cases import single_nodule
from .texture_map import ATTENUATION_METHOD, attenuation_from_ratings
from .volume import crop_box, crop_series, load_series, lung_extent

ROOT = Path(__file__).resolve().parent.parent
CASES_DIR = ROOT / "data" / "cases"
SCHEMA = ROOT / "shared" / "schemas" / "case-manifest.schema.json"
ATTRIBUTION = (
    "CT images: LIDC-IDRI collection, The Cancer Imaging Archive (TCIA), licence CC BY 3.0, "
    "DOI 10.7937/K9/TCIA.2015.LO9QL9SX. "
    "TODO-VERIFY: replace with the exact citation text from the TCIA collection page."
)


def main_cluster(scan):
    clusters = [
        {"anns": a, "n": len(a), "diam": statistics.mean(x.diameter for x in a)}
        for a in scan.cluster_annotations()
        if a
    ]
    mains = [c for c in clusters if c["n"] >= 3 and single_nodule(clusters, c)]
    if len(mains) != 1:
        raise RuntimeError(f"{scan.patient_id}: expected exactly one qualifying cluster, got {len(mains)}")
    return mains[0]["anns"]


def build_case(letter: str, sel: dict, out_root: Path = CASES_DIR) -> dict:
    case_id = f"case-{letter.lower()}"
    out_dir = out_root / case_id
    out_dir.mkdir(parents=True, exist_ok=True)

    scan = pl.query(pl.Scan).filter(pl.Scan.patient_id == sel["patient_id"]).first()
    if scan.series_instance_uid != sel["series_instance_uid"]:
        raise RuntimeError("selection.json series UID does not match pylidc")
    series = load_series(Path(scan.get_path_to_dicom_files()))
    if not np.allclose(series.hu.shape[2], len(scan.slice_zvals)):
        raise RuntimeError("slice count differs from pylidc")

    cluster = main_cluster(scan)
    cmask, cbbox, _ = consensus(cluster, clevel=0.5, pad=[(5, 5), (5, 5), (2, 2)])
    full = np.zeros(series.hu.shape, dtype=np.uint8)
    full[cbbox] = cmask.astype(np.uint8)  # label value 1, same geometry as the CT
    voxels = int(full.sum())

    lungs = lung_extent(series)
    box = crop_box(series, lungs, cbbox)
    cropped = crop_series(series, box)
    mask_c = full[box]
    if int(mask_c.sum()) != voxels:
        raise RuntimeError("crop box cut the nodule mask")
    coverage = float(lungs.mask[box].sum() / lungs.lung_voxels)
    if coverage < 0.99:
        raise RuntimeError(f"crop keeps only {coverage:.3f} of lung voxels")

    m = measure_nodule(mask_c.astype(bool), cropped)
    lobe = lobe_estimate(np.array(m["centroid_mm"]), series, lungs)
    ratings = [int(a.texture) for a in cluster]
    attenuation, uncertain = attenuation_from_ratings(ratings)
    nodule = {
        "id": "n1",
        **m,
        "attenuation": attenuation,
        "attenuation_method": ATTENUATION_METHOD,
        "attenuation_uncertain": uncertain,
        "texture_ratings": ratings,
        "lobe_estimate": lobe,
        "radiologist_count": len(cluster),
    }

    export = export_pair(cropped, mask_c, out_dir)

    sc = reports.SCENARIOS[letter]
    label = f"Example patient {letter}"
    lines = reports.build_lines(letter, label, sel["patient_id"], nodule,
                                bool(scan.contrast_used), cropped.slice_thickness)
    (out_dir / "report.md").write_text(reports.to_markdown(lines), encoding="utf-8")
    reports.to_pdf(lines, out_dir / "report.pdf")

    manifest = {
        "case_id": case_id,
        "lidc_patient_id": sel["patient_id"],
        "study_instance_uid": sel["study_instance_uid"],
        "series_instance_uid": sel["series_instance_uid"],
        "label": label,
        "attribution": ATTRIBUTION,
        "files": {
            "ct": "ct.nii.gz",
            "mask": "mask.nii.gz",
            "report_pdf": "report.pdf",
            "report_md": "report.md",
        },
        "geometry": {
            "spacing": [round(float(x), 6) for x in cropped.spacing],
            "origin": [round(float(x), 4) for x in cropped.origin],
            "direction": [[round(float(x), 6) for x in row] for row in cropped.direction],
            "dims": [int(x) for x in cropped.hu.shape],
            "slice_count": int(cropped.hu.shape[2]),
            "coordinate_system": "LPS",
            "crop": {
                "rows": [box[0].start, box[0].stop],
                "cols": [box[1].start, box[1].stop],
                "slices": [box[2].start, box[2].stop],
                "original_dims": [int(x) for x in series.hu.shape],
                "lung_voxel_coverage": round(coverage, 4),
                "note": "same box for CT and mask; both lungs kept with 10 mm in-plane and 25 mm z margin",
            },
            "hu_range": [-1024, 3071],
        },
        "nodules": [nodule],
        "scenario": {
            "label": "Fictional age and history written for this demo",
            "age_years": sc["age"],
            "sex": sc["sex"],
            "indication": sc["indication"],
            "history": sc["history"],
            "exam": sc["exam"],
            "source": sc["source"],
        },
        "export": export,
        "selection": {
            "pylidc_series_slice_thickness_mm": sel["slice_thickness"],
            "contrast_used": bool(scan.contrast_used),
            "consensus": "pylidc consensus clevel=0.5",
            "mask_source": "radiologists' consensus mask (not an AI segmentation)",
        },
        "todo_verify": [
            "clinician to confirm lobe estimate",
            "exact TCIA citation text",
        ],
    }
    errors = sorted(Draft202012Validator(json.loads(SCHEMA.read_text())).iter_errors(manifest),
                    key=lambda e: list(e.path))
    if errors:
        raise RuntimeError("manifest invalid: " + "; ".join(e.message for e in errors))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest
