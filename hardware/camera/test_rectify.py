"""Run: python3 -m unittest test_rectify -v   (synthetic scenes, no camera needed)"""
import time
import unittest

import cv2
import numpy as np

import rectify
from aruco_markers import marker_image

W, H = 640, 480
TRAY = (400, 300)  # tray size in the flat "world" picture


def flat_tray(ids=(0, 1, 2, 3), marker_px=60):
    """Top-down picture of a tray: white board, markers on the corners, a red patch at 25%/25%."""
    img = np.full((TRAY[1], TRAY[0], 3), 255, np.uint8)
    half = marker_px // 2
    centers = {0: (half + 10, half + 10), 1: (TRAY[0] - half - 10, half + 10),
               2: (TRAY[0] - half - 10, TRAY[1] - half - 10), 3: (half + 10, TRAY[1] - half - 10)}
    for i in ids:
        cx, cy = centers[i]
        m = cv2.cvtColor(marker_image(i, marker_px), cv2.COLOR_GRAY2BGR)
        img[cy - half:cy + half, cx - half:cx + half] = m
    cv2.rectangle(img, (150, 110), (190, 150), (0, 0, 255), -1)  # red square, tray-centre area
    return img, centers


def camera_view(tray, tilt=0.0, angle=0.0, scale=1.0):
    """Perspective-warp the flat tray into a camera frame."""
    h, w = tray.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    c = np.float32([W / 2, H / 2])
    dst = (src - np.float32([w / 2, h / 2])) * scale
    dst[:, 0] *= np.float32([1 - tilt, 1 - tilt, 1 + tilt, 1 + tilt])  # keystone
    r = np.deg2rad(angle)
    rot = np.float32([[np.cos(r), -np.sin(r)], [np.sin(r), np.cos(r)]])
    dst = dst @ rot.T + c
    M = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    return cv2.warpPerspective(tray, M, (W, H), borderValue=(90, 90, 90))


class RectifyTest(unittest.TestCase):
    def setUp(self):
        self.tray, self.centers = flat_tray()

    def _red_centroid(self, img):
        mask = cv2.inRange(cv2.cvtColor(img, cv2.COLOR_BGR2HSV), (0, 150, 100), (10, 255, 255))
        ys, xs = np.nonzero(mask)
        self.assertGreater(len(xs), 50, "red patch not visible")
        return xs.mean() / img.shape[1], ys.mean() / img.shape[0]

    def test_finds_all_four_markers(self):
        self.assertEqual(sorted(rectify.find_markers(camera_view(self.tray))), [0, 1, 2, 3])

    def test_rectified_view_puts_patch_where_it_belongs(self):
        # Expected position of the patch inside the rectangle spanned by the marker centers.
        (x0, y0), (x1, _), (_, y2) = self.centers[0], self.centers[1], self.centers[2]
        want = ((170 - x0) / (x1 - x0), (130 - y0) / (y2 - y0))
        for kw in ({}, {"tilt": 0.15}, {"angle": 12}, {"angle": -20, "tilt": 0.1, "scale": 0.8}):
            with self.subTest(**kw):
                out = rectify.rectify(camera_view(self.tray, **kw))
                self.assertIsNotNone(out)
                self.assertEqual(out.shape, (480, 640, 3))
                got = self._red_centroid(out)
                self.assertAlmostEqual(got[0], want[0], delta=0.03)
                self.assertAlmostEqual(got[1], want[1], delta=0.03)

    def test_missing_marker_returns_none(self):
        tray, _ = flat_tray(ids=(0, 1, 2))
        self.assertIsNone(rectify.rectify(camera_view(tray)))

    def test_no_markers_returns_none(self):
        self.assertIsNone(rectify.rectify(np.full((H, W, 3), 128, np.uint8)))

    def test_custom_size(self):
        out = rectify.rectify(camera_view(self.tray), size=(320, 240))
        self.assertEqual(out.shape, (240, 320, 3))

    def test_within_latency_budget(self):
        frame = camera_view(self.tray)
        rectify.rectify(frame)  # warm up
        t0 = time.perf_counter()
        for _ in range(20):
            rectify.rectify(frame)
        ms = (time.perf_counter() - t0) / 20 * 1000
        print(f"detect+rectify {ms:.1f} ms")
        self.assertLess(ms, 50)  # AGENTS.md §6 budget: gating + rectify < 50 ms


if __name__ == "__main__":
    unittest.main()
