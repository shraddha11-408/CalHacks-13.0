import cv2
import numpy as np
import pytest

from cvlib import load_slots

# BGR fills that sit well inside the default config HSV ranges
BLUE, GREEN, YELLOW, WHITE = (200, 90, 30), (60, 170, 40), (40, 210, 240), (245, 245, 245)


@pytest.fixture
def slots():
    return load_slots()


def make_tray(items: dict[str, tuple[int, int, int]], size=(800, 600), slots=None) -> np.ndarray:
    """Synthetic rectified tray: beige background, a colored block centred in each named slot."""
    slots = slots or load_slots()
    w, h = size
    # mid-tone brown tray (V≈140): a very pale tray would read as "white cloth"
    img = np.full((h, w, 3), (95, 120, 140), np.uint8)
    for name, color in items.items():
        nx, ny, nw, nh = slots[name]
        cx, cy = int((nx + nw / 2) * w), int((ny + nh / 2) * h)
        cv2.rectangle(img, (cx - 60, cy - 40), (cx + 60, cy + 40), color, -1)
    return img


@pytest.fixture
def tray_factory():
    return make_tray
