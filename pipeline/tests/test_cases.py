"""Checks on the built demo cases in data/cases (run `python -m pipeline.build_all` first)."""

from __future__ import annotations

import itertools
import json
import re
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from jsonschema import Draft202012Validator

from pipeline.measure import feret_axes, measure_nodule, round_half_up
from pipeline.texture_map import attenuation_from_ratings
from pipeline.volume import Series

ROOT = Path(__file__).resolve().parents[2]
CASES = sorted(p for p in (ROOT / "data" / "cases").glob("case-*") if (p / "manifest.json").exists())
SCHEMA = json.loads((ROOT / "shared" / "schemas" / "case-manifest.schema.json").read_text())


def test_cases_are_built():
    assert len(CASES) == 3, "run python -m pipeline.build_all"


def load(case_dir: Path):
    manifest = json.loads((case_dir / "manifest.json").read_text())
    ct = nib.load(case_dir / manifest["files"]["ct"])
    mask = nib.load(case_dir / manifest["files"]["mask"])
    return manifest, ct, mask


def series_from_manifest(manifest: dict, shape) -> Series:
    g = manifest["geometry"]
    return Series(
        hu=np.zeros(shape, dtype=np.int16),
        spacing=tuple(g["spacing"]),
        origin=np.array(g["origin"]),
        direction=np.array(g["direction"]),
        sop_uids=[f"uid-{i}" for i in range(shape[2])],
        slice_thickness=None,
        contrast_agent_present=False,
    )


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_manifest_valid(case_dir):
    manifest, _, _ = load(case_dir)
    errors = list(Draft202012Validator(SCHEMA).iter_errors(manifest))
    assert errors == [], [e.message for e in errors]


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_mask_and_ct_share_shape_and_affine(case_dir):
    manifest, ct, mask = load(case_dir)
    assert ct.shape == mask.shape == tuple(manifest["geometry"]["dims"])
    assert np.allclose(ct.affine, mask.affine)
    assert np.allclose(np.linalg.norm(ct.affine[:3, :3], axis=0), manifest["geometry"]["spacing"], atol=1e-4)
    assert set(np.unique(np.asarray(mask.dataobj))) == {0, 1}
    # slices ascend in z (third axis), which is the viewer's order
    assert manifest["geometry"]["direction"][2][2] > 0


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_origin_matches_affine(case_dir):
    manifest, ct, _ = load(case_dir)
    ras = np.array(manifest["geometry"]["origin"]) * np.array([-1, -1, 1])
    assert np.allclose(ct.affine[:3, 3], ras, atol=1e-3)


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_max_area_slice_equals_slice_index(case_dir):
    manifest, _, mask = load(case_dir)
    data = np.asarray(mask.dataobj)
    areas = data.sum(axis=(0, 1))
    assert int(np.argmax(areas)) == manifest["nodules"][0]["slice_index"]


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_measurements_recompute_from_exported_mask(case_dir):
    manifest, _, mask = load(case_dir)
    data = np.asarray(mask.dataobj).astype(bool)
    n = manifest["nodules"][0]
    m = measure_nodule(data, series_from_manifest(manifest, data.shape))
    for key in ("mean_diameter_mm", "long_axis_mm", "short_axis_mm", "fleischner_size_mm",
                "volume_mm3", "slice_index"):
        assert m[key] == n[key], key
    assert np.allclose(m["centroid_mm"], n["centroid_mm"], atol=0.01)
    assert abs(n["fleischner_size_mm"] - n["mean_diameter_mm"]) <= 0.5
    assert round_half_up(n["mean_diameter_mm"]) in (n["fleischner_size_mm"], n["fleischner_size_mm"] + 1)


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_feret_matches_brute_force(case_dir):
    manifest, _, mask = load(case_dir)
    data = np.asarray(mask.dataobj)
    k = manifest["nodules"][0]["slice_index"]
    sr, sc, _ = manifest["geometry"]["spacing"]
    rr, cc = np.nonzero(data[:, :, k])
    pts = np.unique(np.concatenate([
        np.stack([(cc + dx) * sc, (rr + dy) * sr], axis=1)
        for dx, dy in itertools.product((-0.5, 0.5), repeat=2)]), axis=0)
    d = np.linalg.norm(pts[:, None] - pts[None], axis=2)
    assert abs(d.max() - manifest["nodules"][0]["long_axis_mm"]) <= 0.06


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_sop_uid_matches_dicom_when_raw_present(case_dir):
    import pydicom

    manifest, _, _ = load(case_dir)
    raw = ROOT / "data" / "raw" / "LIDC-IDRI" / manifest["lidc_patient_id"] / \
        manifest["study_instance_uid"] / manifest["series_instance_uid"]
    if not raw.exists():
        pytest.skip("raw DICOM not present")
    heads = [pydicom.dcmread(f, stop_before_pixels=True) for f in raw.glob("*.dcm")]
    heads.sort(key=lambda d: float(d.ImagePositionPatient[2]))
    crop_k0 = manifest["geometry"]["crop"]["slices"][0]
    n = manifest["nodules"][0]
    assert str(heads[crop_k0 + n["slice_index"]].SOPInstanceUID) == n["slice_sop_uid"]


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_lungs_fully_inside_crop(case_dir):
    manifest, _, _ = load(case_dir)
    assert manifest["geometry"]["crop"]["lung_voxel_coverage"] >= 0.99


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_export_size_reported(case_dir):
    manifest, _, _ = load(case_dir)
    actual = sum((case_dir / f).stat().st_size for f in ("ct.nii.gz", "mask.nii.gz")) / 1e6
    assert abs(actual - manifest["export"]["total_mb"]) < 0.3


def report_lines(case_dir: Path) -> list[str]:
    text = (case_dir / "report.md").read_text(encoding="utf-8")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_report_matches_manifest(case_dir):
    manifest, _, _ = load(case_dir)
    n = manifest["nodules"][0]
    lines = report_lines(case_dir)
    assert 25 <= len(lines) <= 45
    assert "Example report written for this demo. Not a real patient." in lines[1]
    assert "Fictional age and history written for this demo." in lines[2]
    idx = next(i for i, ln in enumerate(lines) if "nodule is seen" in ln)
    assert 30 <= idx + 1 <= 40, f"nodule sentence on line {idx + 1}"
    sentence = lines[idx]
    assert f"{n['fleischner_size_mm']} mm" in sentence
    assert n["attenuation"] in sentence
    assert n["lobe_estimate"]["label"] in sentence
    assert re.search(r"\bno pleural effusion\b", lines[idx - 1], re.IGNORECASE)  # negation next to it
    assert sentence.startswith("However,")
    text = " ".join(lines).lower()
    assert "risk" not in text
    assert str(manifest["scenario"]["age_years"]) in text
    other = " ".join(ln for i, ln in enumerate(lines) if i != idx and "slices" not in ln)
    assert not re.search(r"\d\s*mm\b", other)  # the nodule size appears only in its sentence


def test_case_a_has_distractor_finding():
    lines = report_lines(next(p for p in CASES if p.name == "case-a"))
    assert any("rib" in ln and "fracture" in ln for ln in lines)


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_pdf_exists_and_reads(case_dir):
    assert (case_dir / "report.pdf").read_bytes()[:5] == b"%PDF-"


def test_attenuation_mapping():
    assert attenuation_from_ratings([1, 1, 1, 1]) == ("ground-glass", False)
    assert attenuation_from_ratings([2, 2, 3, 2]) == ("ground-glass", False)
    assert attenuation_from_ratings([3, 3, 3]) == ("part-solid", False)
    assert attenuation_from_ratings([4, 4, 5]) == ("solid", False)
    assert attenuation_from_ratings([5, 5, 5, 5]) == ("solid", False)
    assert attenuation_from_ratings([1, 4, 4]) == ("solid", True)  # range 3 > 2


def test_feret_on_synthetic_disc():
    yy, xx = np.mgrid[-20:21, -20:21]
    disc = (yy**2 + xx**2) <= 25  # radius 5 px
    long_axis, short_axis = feret_axes(disc, 0.5, 0.5)
    assert 5.0 <= short_axis <= long_axis + 1e-9 <= 6.2
    assert long_axis - short_axis < 1.0


def test_feret_on_anisotropic_rectangle():
    rect = np.zeros((20, 30), dtype=bool)
    rect[5:15, 5:25] = True  # 10 rows x 20 cols, spacing 1 x 1 mm
    long_axis, short_axis = feret_axes(rect, 1.0, 1.0)
    assert abs(long_axis - np.hypot(20, 10)) < 1e-6
    assert short_axis > 0
