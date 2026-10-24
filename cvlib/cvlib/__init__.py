"""Checker helper library. Droid composes checkers from these (AGENTS.md §5)."""
from .measure import (
    color_fraction,
    count_blobs,
    hsv_mask,
    hsv_range_from_patch,
    load_hsv,
    load_slots,
    region,
    template_score,
)
from .rectify import detect, homography, rectify, warp

__all__ = [
    "color_fraction",
    "count_blobs",
    "detect",
    "homography",
    "hsv_mask",
    "hsv_range_from_patch",
    "load_hsv",
    "load_slots",
    "rectify",
    "region",
    "template_score",
    "warp",
]
