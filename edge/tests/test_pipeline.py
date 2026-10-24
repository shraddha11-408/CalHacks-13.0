"""Pipeline behaviour (no camera): look_at_tray vs check_ready, and gate + rectify latency."""
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from stepwise_edge.config import load_config
from stepwise_edge.events import EventBus
from stepwise_edge.pipeline import Pipeline

MAT = Path(__file__).resolve().parents[2] / "props" / "aruco_test_mat.png"


class FakeCamera:
    name = "fake"
    error = None


@pytest.fixture(scope="module")
def scene():
    mat = cv2.imread(str(MAT))
    if mat is None:
        pytest.skip("props/aruco_test_mat.png missing")
    H0, W0 = mat.shape[:2]
    P = cv2.getPerspectiveTransform(np.float32([[0, 0], [W0, 0], [W0, H0], [0, H0]]), np.float32([[150, 95], [505, 120], [560, 400], [85, 380]]))
    bg = np.full((480, 640, 3), 90, np.uint8)
    return cv2.warpPerspective(mat, P, (640, 480), dst=bg, borderMode=cv2.BORDER_TRANSPARENT)


def run(pipe, frame, seconds, t=0.0, fps=30):
    events = []
    for _ in range(int(seconds * fps)):
        out = pipe.process(frame, t)
        if out["event"]:
            events.append(out["event"])
        t += 1 / fps
    return events, t


def test_markers_visible_emits_check_ready(scene):
    pipe = Pipeline(FakeCamera(), load_config(), EventBus())
    events, _ = run(pipe, scene, 1.0)
    assert [e["type"] for e in events] == ["check_ready"]


def test_no_markers_emits_look_at_tray_and_no_check():
    pipe = Pipeline(FakeCamera(), load_config(), EventBus())
    blank = np.full((480, 640, 3), 100, np.uint8)
    events, _ = run(pipe, blank, 1.0)
    assert [e["type"] for e in events] == ["look_at_tray"]
    assert pipe.checks == 0


def test_gate_plus_rectify_latency_under_50ms(scene):
    pipe = Pipeline(FakeCamera(), load_config(), EventBus())
    lat = []
    for i in range(200):
        t0 = time.perf_counter()
        pipe.process(scene, i / 30)
        lat.append((time.perf_counter() - t0) * 1000)
    lat.sort()
    p50, p99 = lat[100], lat[197]
    print(f"\ngate+detect+rectify per frame: p50 {p50:.2f} ms, p99 {p99:.2f} ms")
    assert p99 < 50
