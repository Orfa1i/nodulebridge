"""Render one overlay PNG per case from the EXPORTED ct.nii.gz and mask.nii.gz.

This reads the same files a viewer loads, at the manifest's slice_index, so it checks that the
mask sits on the nodule. Output: docs/build/evidence/phase-02/<case>-overlay.png
Usage: python -m pipeline.evidence
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np

from .build_case import CASES_DIR, ROOT

OUT = ROOT / "docs" / "build" / "evidence" / "phase-02"


def render(case_dir: Path) -> Path:
    manifest = json.loads((case_dir / "manifest.json").read_text())
    n = manifest["nodules"][0]
    ct = np.asarray(nib.load(case_dir / "ct.nii.gz").dataobj)
    mask = np.asarray(nib.load(case_dir / "mask.nii.gz").dataobj)
    k = n["slice_index"]
    sr, sc, _ = manifest["geometry"]["spacing"]
    ci, cj, _ = n["centroid_voxel"]
    half_r, half_c = int(30 / sr), int(30 / sc)  # 60 mm window around the nodule
    r0, c0 = max(int(ci) - half_r, 0), max(int(cj) - half_c, 0)
    r1, c1 = min(int(ci) + half_r, ct.shape[0]), min(int(cj) + half_c, ct.shape[1])

    fig, axes = plt.subplots(1, 2, figsize=(12, 6.2), facecolor="white")
    for ax, (rs, cs, title) in zip(
        axes,
        [(slice(0, ct.shape[0]), slice(0, ct.shape[1]), "full slice"),
         (slice(r0, r1), slice(c0, c1), "zoom, 60 mm window")],
        strict=True,
    ):
        img = ct[rs, cs, k].astype(float)
        ax.imshow(img, cmap="gray", vmin=-1350, vmax=150, aspect=sr / sc)  # lung window
        m = mask[rs, cs, k]
        ax.contour(m, levels=[0.5], colors="yellow", linewidths=1.4)
        ax.set_title(title)
        ax.axis("off")
    fig.suptitle(
        f"{manifest['label']} · {manifest['lidc_patient_id']} · slice {k}/{manifest['geometry']['slice_count']}"
        f" (0-based index) · {n['long_axis_mm']} x {n['short_axis_mm']} mm · {n['attenuation']}"
        f" · {n['lobe_estimate']['label']} (estimate)\n"
        "Radiologists' consensus mask over exported CT. Example data, not a diagnosis.",
        fontsize=10,
    )
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{manifest['case_id']}-overlay.png"
    fig.savefig(path, dpi=110, bbox_inches="tight")
    plt.close(fig)
    return path


def main() -> None:
    for case_dir in sorted(CASES_DIR.glob("case-*")):
        print(render(case_dir))


if __name__ == "__main__":
    main()
