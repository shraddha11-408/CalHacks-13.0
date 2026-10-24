"""Measurement helpers Droid composes checkers from (AGENTS.md §5).

All functions take BGR uint8 images (OpenCV order). HSV ranges use OpenCV's
scale: H 0–179, S 0–255, V 0–255, given as ((h, s, v), (h, s, v)). A range
whose low hue is above its high hue wraps around 0 (for reds).
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

HSVRange = tuple[tuple[int, int, int], tuple[int, int, int]]
Slot = tuple[float, float, float, float]  # normalized x, y, w, h

_CONFIG = Path(__file__).resolve().parents[2] / "config.yaml"


def load_slots(config_path: Path | str = _CONFIG) -> dict[str, Slot]:
    import yaml

    ws = yaml.safe_load(Path(config_path).read_text())["workspace"]
    slots = {k: tuple(v) for k, v in ws["slots"].items()}
    slots["done_mark"] = tuple(ws["done_mark"])
    return slots


def load_hsv(config_path: Path | str = _CONFIG) -> dict[str, HSVRange]:
    import yaml

    raw = (yaml.safe_load(Path(config_path).read_text()) or {}).get("hsv") or {}
    return {k: (tuple(v["lo"]), tuple(v["hi"])) for k, v in raw.items()}


def region(img: np.ndarray, name: str, slots: dict[str, Slot] | None = None) -> np.ndarray:
    """Crop a named slot from a rectified tray image (slot geometry from config.yaml)."""
    slots = slots or load_slots()
    if name not in slots:
        raise KeyError(f"unknown region {name!r}; known: {sorted(slots)}")
    nx, ny, nw, nh = slots[name]
    h, w = img.shape[:2]
    x0, y0 = int(round(nx * w)), int(round(ny * h))
    x1, y1 = int(round((nx + nw) * w)), int(round((ny + nh) * h))
    return img[max(y0, 0) : min(y1, h), max(x0, 0) : min(x1, w)]


def hsv_mask(crop: np.ndarray, hsv_range: HSVRange) -> np.ndarray:
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    (h0, s0, v0), (h1, s1, v1) = hsv_range
    if h0 <= h1:
        return cv2.inRange(hsv, (h0, s0, v0), (h1, s1, v1))
    # hue wraps around 0 (reds)
    a = cv2.inRange(hsv, (h0, s0, v0), (179, s1, v1))
    b = cv2.inRange(hsv, (0, s0, v0), (h1, s1, v1))
    return cv2.bitwise_or(a, b)


def color_fraction(crop: np.ndarray, hsv_range: HSVRange) -> float:
    """Share of pixels (0–1) inside the HSV range."""
    if crop.size == 0:
        return 0.0
    m = hsv_mask(crop, hsv_range)
    return float(np.count_nonzero(m)) / m.size


def count_blobs(crop: np.ndarray, hsv_range: HSVRange, min_area: int = 200) -> int:
    """Number of connected regions in the HSV range with at least min_area pixels."""
    if crop.size == 0:
        return 0
    m = hsv_mask(crop, hsv_range)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    return int(sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area))


def template_score(crop: np.ndarray, ref_crop: np.ndarray) -> float:
    """Similarity (0–1) of a crop to the reference frame's crop. 1 = identical.

    Normalized cross-correlation on blurred grayscale, resized to the ref size,
    so small lighting shifts and a few pixels of rectify jitter don't matter much.
    """
    if crop.size == 0 or ref_crop.size == 0:
        return 0.0
    a = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    b = cv2.cvtColor(ref_crop, cv2.COLOR_BGR2GRAY) if ref_crop.ndim == 3 else ref_crop
    a = cv2.resize(a, (b.shape[1], b.shape[0]), interpolation=cv2.INTER_AREA)
    a = cv2.GaussianBlur(a, (5, 5), 0).astype(np.float32)
    b = cv2.GaussianBlur(b, (5, 5), 0).astype(np.float32)
    a -= a.mean()
    b -= b.mean()
    ea, eb = float((a * a).sum()), float((b * b).sum())
    flat = 1e-3 * a.size  # variance ~0: no structure to correlate
    if ea < flat and eb < flat:
        # both flat: similar if their brightness matches
        return 1.0 if abs(float(crop.mean()) - float(ref_crop.mean())) < 10 else 0.0
    if ea < flat or eb < flat:
        return 0.0  # one has structure, the other doesn't (e.g. empty slot vs. filled ref)
    return max(0.0, float((a * b).sum() / np.sqrt(ea * eb)))


def hsv_range_from_patch(patch: np.ndarray, margin: tuple[int, int, int] = (8, 40, 40)) -> HSVRange:
    """Calibration: HSV range covering the 5th–95th percentile of a sampled patch, plus margin."""
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.int32)
    h = hsv[:, 0]
    # Reds straddle hue 0: shift by 90 if that makes the spread smaller.
    shifted = (h + 90) % 180
    use_shift = np.ptp(np.percentile(shifted, [5, 95])) < np.ptp(np.percentile(h, [5, 95]))
    hh = shifted if use_shift else h
    h_lo, h_hi = np.percentile(hh, [5, 95])
    h_lo, h_hi = int(h_lo) - margin[0], int(h_hi) + margin[0]
    if use_shift:
        h_lo, h_hi = (h_lo - 90) % 180, (h_hi - 90) % 180
    else:
        h_lo, h_hi = max(h_lo, 0), min(h_hi, 179)
    s_lo, s_hi = np.percentile(hsv[:, 1], [5, 95])
    v_lo, v_hi = np.percentile(hsv[:, 2], [5, 95])
    lo = (int(h_lo), int(max(s_lo - margin[1], 0)), int(max(v_lo - margin[2], 0)))
    hi = (int(h_hi), int(min(s_hi + margin[1], 255)), int(min(v_hi + margin[2], 255)))
    return lo, hi
