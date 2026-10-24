from pathlib import Path

import cv2
import numpy as np
import pytest

from cvlib import detect, homography, rectify

MAT = Path(__file__).resolve().parents[2] / "props" / "aruco_test_mat.png"
CM = 300 / 2.54


@pytest.fixture(scope="module")
def mat():
    img = cv2.imread(str(MAT))
    if img is None:
        pytest.skip("props/aruco_test_mat.png missing — run scripts/make_aruco_pdf.py")
    return img


def _scene(mat, dst):
    H0, W0 = mat.shape[:2]
    P = cv2.getPerspectiveTransform(np.float32([[0, 0], [W0, 0], [W0, H0], [0, H0]]), np.float32(dst))
    scene = np.full((480, 640, 3), 90, np.uint8)
    return cv2.warpPerspective(mat, P, (640, 480), dst=scene, borderMode=cv2.BORDER_TRANSPARENT), P


def _inner_corners(mat):
    H0, W0 = mat.shape[:2]
    m, margin = int(4.5 * CM), int(1.0 * CM)
    return np.float32([[margin + m, margin + m], [W0 - margin - m, margin + m], [W0 - margin - m, H0 - margin - m], [margin + m, H0 - margin - m]])


@pytest.mark.parametrize("dst", [
    [[150, 95], [505, 120], [560, 400], [85, 380]],   # tilted, ~50 cm
    [[60, 40], [600, 40], [600, 440], [60, 440]],     # straight on, close
    [[220, 160], [440, 150], [470, 330], [200, 340]],  # far (~60 cm+)
])
def test_rectify_maps_inner_corners_to_canvas(mat, dst):
    scene, P = _scene(mat, dst)
    found = detect(scene)
    assert {0, 1, 2, 3} <= set(found)
    H = homography(found, (0, 1, 2, 3), (800, 600))
    inner = cv2.perspectiveTransform(_inner_corners(mat)[None], P)
    got = cv2.perspectiveTransform(inner, H)[0]
    want = np.float32([[0, 0], [799, 0], [799, 599], [0, 599]])
    assert np.abs(got - want).max() < 6.0


def test_rectify_returns_none_without_all_markers(mat):
    scene, _ = _scene(mat, [[150, 95], [505, 120], [560, 400], [85, 380]])
    scene[300:480, 0:220] = 90  # cover marker 3 (bottom-left)
    assert rectify(scene) is None


def test_rectify_none_on_blank_frame():
    assert rectify(np.zeros((480, 640, 3), np.uint8)) is None
