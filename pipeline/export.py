"""Export CT and mask as NIfTI (option 1 in docs/build/02, step 5).

Chosen format: ct.nii.gz (int16 HU) + mask.nii.gz (uint8, label 1) with an identical RAS affine.
The third array axis is the slice axis, ordered by ImagePositionPatient z ascending, so a slice
index in the manifest is an index into that axis. Loaded in the browser with Cornerstone's NIfTI
volume loader (Phase 3).
"""

from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np

from .volume import Series


def _image(data: np.ndarray, affine: np.ndarray, dtype) -> nib.Nifti1Image:
    img = nib.Nifti1Image(data.astype(dtype), affine)
    img.set_qform(affine, code=1)
    img.set_sform(affine, code=1)
    img.header.set_xyzt_units("mm")
    return img


def export_pair(series: Series, mask: np.ndarray, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    affine = series.affine_ras
    ct_path, mask_path = out_dir / "ct.nii.gz", out_dir / "mask.nii.gz"
    nib.save(_image(series.hu, affine, np.int16), ct_path)
    nib.save(_image(mask, affine, np.uint8), mask_path)
    mb = lambda p: round(p.stat().st_size / 1e6, 1)
    return {
        "format": "NIfTI-1 gzip (option 1)",
        "ct_mb": mb(ct_path),
        "mask_mb": mb(mask_path),
        "total_mb": round(mb(ct_path) + mb(mask_path), 1),
        "target_mb": 60,
        "ct_dtype": "int16 HU, values below -1024 clipped to -1024 (scanner padding)",
    }
