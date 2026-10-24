"""ArUco tray rectification (AGENTS.md §5, §6 step 2).

Markers sit on the tray rim at the corners: id 0 top-left, 1 top-right,
2 bottom-right, 3 bottom-left. We map each marker's INNER corner (the one
pointing at the tray centre) to the corners of a fixed top-down canvas, so the
rectified image is exactly the work surface and the markers stay outside it.
"""
from __future__ import annotations

import cv2
import numpy as np

DICT = cv2.aruco.DICT_4X4_50
Corners = dict[int, np.ndarray]

_detector: cv2.aruco.ArucoDetector | None = None


def detector() -> cv2.aruco.ArucoDetector:
    global _detector
    if _detector is None:
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        _detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICT), params)
    return _detector


def detect(frame: np.ndarray) -> Corners:
    """Return {marker_id: 4x2 corners (TL, TR, BR, BL of the marker itself)}."""
    gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    corners, ids, _ = detector().detectMarkers(gray)
    if ids is None:
        return {}
    return {int(i): c.reshape(4, 2) for i, c in zip(ids.flatten(), corners)}


def homography(found: Corners, marker_ids=(0, 1, 2, 3), size=(800, 600)) -> np.ndarray | None:
    """Image → rectified-canvas homography from detected markers, or None if any is missing."""
    if not all(m in found for m in marker_ids):
        return None
    # Inner corner of each marker: TL marker's BR corner, TR marker's BL corner, ...
    src = np.array([found[m][(k + 2) % 4] for k, m in enumerate(marker_ids)], dtype=np.float32)
    w, h = size
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def warp(frame: np.ndarray, H: np.ndarray, size=(800, 600)) -> np.ndarray:
    return cv2.warpPerspective(frame, H, tuple(size))


def rectify(frame: np.ndarray, marker_ids=(0, 1, 2, 3), size=(800, 600)) -> np.ndarray | None:
    """Top-down tray image, or None if any corner marker is missing.

    marker_ids are in order TL, TR, BR, BL. No markers → caller emits
    "look_at_tray" and does not check.
    """
    H = homography(detect(frame), marker_ids, size)
    return None if H is None else warp(frame, H, size)
