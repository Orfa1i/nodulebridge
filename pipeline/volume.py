"""Load a DICOM CT series, build geometry, estimate lung extent and crop box."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pydicom
from scipy import ndimage as ndi

HU_MIN, HU_MAX = -1024, 3071  # int16-safe range; values below HU_MIN are scanner padding


@dataclass
class Series:
    hu: np.ndarray  # int16, shape (rows, cols, slices); slices sorted by z ascending
    spacing: tuple[float, float, float]  # (row, col, slice) in mm
    origin: np.ndarray  # LPS mm of voxel (0, 0, 0)
    direction: np.ndarray  # 3x3, columns = unit vectors for the (row, col, slice) axes, LPS
    sop_uids: list[str]
    slice_thickness: float | None
    contrast_agent_present: bool

    @property
    def affine_lps(self) -> np.ndarray:
        a = np.eye(4)
        a[:3, :3] = self.direction * np.array(self.spacing)
        a[:3, 3] = self.origin
        return a

    @property
    def affine_ras(self) -> np.ndarray:
        return np.diag([-1.0, -1.0, 1.0, 1.0]) @ self.affine_lps

    def voxel_to_lps(self, ijk) -> np.ndarray:
        return (self.affine_lps @ np.append(np.asarray(ijk, dtype=float), 1.0))[:3]


def load_series(series_dir: Path) -> Series:
    files = sorted(series_dir.glob("*.dcm"))
    if not files:
        raise FileNotFoundError(f"no DICOM files in {series_dir}")
    datasets = [pydicom.dcmread(f) for f in files]
    datasets.sort(key=lambda d: float(d.ImagePositionPatient[2]))  # the viewer's order
    slices = []
    for d in datasets:
        px = d.pixel_array.astype(np.int32) * float(d.RescaleSlope) + float(d.RescaleIntercept)
        slices.append(np.clip(np.rint(px), HU_MIN, HU_MAX).astype(np.int16))
    hu = np.stack(slices, axis=-1)

    first, last = datasets[0], datasets[-1]
    ipp0 = np.array(first.ImagePositionPatient, dtype=float)
    ipp1 = np.array(last.ImagePositionPatient, dtype=float)
    n = len(datasets)
    step = (ipp1 - ipp0) / (n - 1)
    zs = np.array([float(d.ImagePositionPatient[2]) for d in datasets])
    if not np.allclose(np.diff(zs), np.diff(zs).mean(), atol=0.01):
        raise ValueError("non-uniform slice spacing; resample before export")
    iop = np.array(first.ImageOrientationPatient, dtype=float)
    row_cos, col_cos = iop[:3], iop[3:]  # row_cos: direction of increasing column index
    sr, sc = (float(x) for x in first.PixelSpacing)
    sk = float(np.linalg.norm(step))
    direction = np.stack([col_cos, row_cos, step / sk], axis=1)
    thickness = float(first.SliceThickness) if "SliceThickness" in first else None
    return Series(
        hu=hu,
        spacing=(sr, sc, sk),
        origin=ipp0,
        direction=direction,
        sop_uids=[str(d.SOPInstanceUID) for d in datasets],
        slice_thickness=thickness,
        contrast_agent_present="ContrastBolusAgent" in first,
    )


@dataclass
class LungExtent:
    r: tuple[int, int]
    c: tuple[int, int]
    k: tuple[int, int]  # slices whose lung area is >= 10% of the maximum (excludes trachea tail)
    lung_voxels: int
    mask: np.ndarray  # bool, same shape as the CT


def lung_extent(series: Series) -> LungExtent:
    air = series.hu < -320
    lung = np.zeros_like(air)
    for k in range(air.shape[2]):
        lab, _ = ndi.label(air[:, :, k])
        border = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
        lung[:, :, k] = air[:, :, k] & ~np.isin(lab, border[border > 0])
    lab3, n = ndi.label(lung)
    sizes = ndi.sum(lung, lab3, index=np.arange(1, n + 1))
    keep = np.flatnonzero(sizes >= 0.05 * sizes.max()) + 1
    lung = np.isin(lab3, keep)
    area = lung.sum(axis=(0, 1))
    valid = np.flatnonzero(area >= 0.10 * area.max())
    k0, k1 = int(valid[0]), int(valid[-1])
    rr = np.flatnonzero(lung[:, :, k0 : k1 + 1].any(axis=(1, 2)))
    cc = np.flatnonzero(lung[:, :, k0 : k1 + 1].any(axis=(0, 2)))
    return LungExtent(
        (int(rr[0]), int(rr[-1])), (int(cc[0]), int(cc[-1])), (k0, k1), int(lung.sum()), lung
    )


def crop_box(series: Series, lungs: LungExtent, nodule_bbox: tuple[slice, slice, slice]):
    """One box for CT and mask: both lungs plus 10 mm in plane and 25 mm in z, nodule included."""
    sr, sc, sk = series.spacing
    pad_r, pad_c, pad_k = (math.ceil(10 / sr), math.ceil(10 / sc), math.ceil(25 / sk))
    r0 = min(lungs.r[0] - pad_r, nodule_bbox[0].start)
    r1 = max(lungs.r[1] + pad_r, nodule_bbox[0].stop - 1)
    c0 = min(lungs.c[0] - pad_c, nodule_bbox[1].start)
    c1 = max(lungs.c[1] + pad_c, nodule_bbox[1].stop - 1)
    k0 = min(lungs.k[0] - pad_k, nodule_bbox[2].start)
    k1 = max(lungs.k[1] + pad_k, nodule_bbox[2].stop - 1)
    nr, nc, nk = series.hu.shape
    return (
        slice(max(r0, 0), min(r1, nr - 1) + 1),
        slice(max(c0, 0), min(c1, nc - 1) + 1),
        slice(max(k0, 0), min(k1, nk - 1) + 1),
    )


def crop_series(series: Series, box: tuple[slice, slice, slice]) -> Series:
    origin = series.voxel_to_lps((box[0].start, box[1].start, box[2].start))
    return Series(
        hu=series.hu[box],
        spacing=series.spacing,
        origin=origin,
        direction=series.direction,
        sop_uids=series.sop_uids[box[2]],
        slice_thickness=series.slice_thickness,
        contrast_agent_present=series.contrast_agent_present,
    )
