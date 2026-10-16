"""Nodule measurements from a label map, following Fleischner 2017 measurement rules."""

from __future__ import annotations

import math

import numpy as np
from scipy.spatial import ConvexHull

from .volume import LungExtent, Series


def round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def _corner_points(mask2d: np.ndarray, sr: float, sc: float) -> np.ndarray:
    rr, cc = np.nonzero(mask2d)
    pts = [
        np.stack([(cc + dx) * sc, (rr + dy) * sr], axis=1)
        for dx in (-0.5, 0.5)
        for dy in (-0.5, 0.5)
    ]
    return np.unique(np.concatenate(pts), axis=0)


def _chord_length(hull: np.ndarray, u: np.ndarray, v: np.ndarray, a0: float) -> float:
    """Length of the hull's intersection with the line {a = a0} (a along u, b along v)."""
    a, b = hull @ u, hull @ v
    n = len(hull)
    hits: list[float] = []
    for i in range(n):
        a1, a2, b1, b2 = a[i], a[(i + 1) % n], b[i], b[(i + 1) % n]
        if a1 == a2:
            if abs(a1 - a0) < 1e-9:
                hits.extend([b1, b2])
        elif (a1 - a0) * (a2 - a0) <= 0:
            hits.append(b1 + (b2 - b1) * (a0 - a1) / (a2 - a1))
    return float(max(hits) - min(hits)) if hits else 0.0


def feret_axes(mask2d: np.ndarray, sr: float, sc: float) -> tuple[float, float]:
    """Long axis = longest in-plane diameter; short axis = longest chord perpendicular to it."""
    pts = _corner_points(mask2d, sr, sc)
    hull = pts[ConvexHull(pts).vertices]
    d = np.linalg.norm(hull[:, None, :] - hull[None, :, :], axis=2)
    i, j = np.unravel_index(np.argmax(d), d.shape)
    long_axis = float(d[i, j])
    u = (hull[j] - hull[i]) / long_axis
    v = np.array([-u[1], u[0]])
    a = hull @ u
    offsets = list(a) + list(np.linspace(a.min(), a.max(), 201))
    short_axis = max(_chord_length(hull, u, v, float(a0)) for a0 in offsets)
    return long_axis, short_axis


def measure_nodule(mask: np.ndarray, series: Series) -> dict:
    sr, sc, sk = series.spacing
    areas = mask.sum(axis=(0, 1))
    k_max = int(np.argmax(areas))
    long_axis, short_axis = feret_axes(mask[:, :, k_max], sr, sc)
    mean_d = (long_axis + short_axis) / 2.0
    idx = np.argwhere(mask)
    centroid_vox = idx.mean(axis=0)
    centroid_mm = series.voxel_to_lps(centroid_vox)
    return {
        "slice_index": k_max,
        "slice_sop_uid": series.sop_uids[k_max],
        "centroid_voxel": [round(float(x), 2) for x in centroid_vox],
        "centroid_mm": [round(float(x), 2) for x in centroid_mm],
        "long_axis_mm": round(long_axis, 1),
        "short_axis_mm": round(short_axis, 1),
        "mean_diameter_mm": round(mean_d, 1),
        "fleischner_size_mm": round_half_up(mean_d),
        "volume_mm3": round(float(mask.sum()) * sr * sc * sk, 1),
    }


def lobe_estimate(centroid_mm: np.ndarray, series: Series, lungs: LungExtent) -> dict:
    """Geometric estimate only: side from x vs lung mid-line, height from z within lung extent."""
    lo = series.voxel_to_lps((lungs.r[0], lungs.c[0], lungs.k[0]))
    hi = series.voxel_to_lps((lungs.r[1], lungs.c[1], lungs.k[1]))
    x_mid = (lo[0] + hi[0]) / 2
    z_lo, z_hi = sorted([lo[2], hi[2]])
    frac = float((centroid_mm[2] - z_lo) / (z_hi - z_lo))
    side = "left" if centroid_mm[0] > x_mid else "right"  # LPS: +x is the patient's left
    if frac >= 2 / 3:
        region, label, certain = "upper", f"{side} upper lobe", True
    elif frac <= 1 / 3:
        region, label, certain = "lower", f"{side} lower lobe", True
    else:
        region, label, certain = "mid", f"{side} mid-lung zone", False
    return {
        "side": side,
        "region": region,
        "label": label,
        "height_fraction": round(frac, 3),
        "lobe_certain": certain,
        "method": "geometric estimate",
        "todo_verify": "clinician to confirm lobe",
    }
