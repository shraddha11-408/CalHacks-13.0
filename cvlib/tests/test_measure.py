import numpy as np
import pytest

from cvlib import color_fraction, count_blobs, hsv_range_from_patch, load_hsv, region, template_score

from conftest import BLUE, GREEN, WHITE, YELLOW


@pytest.fixture
def hsv():
    return load_hsv()


def test_region_uses_config_geometry(tray_factory, slots):
    img = tray_factory({})
    crop = region(img, "slot_A", slots)
    nx, ny, nw, nh = slots["slot_A"]
    assert crop.shape[:2] == (round((ny + nh) * 600) - round(ny * 600), round((nx + nw) * 800) - round(nx * 800))


def test_region_unknown_name_raises(tray_factory):
    with pytest.raises(KeyError):
        region(tray_factory({}), "slot_Z")


def test_color_fraction_finds_item_only_in_its_slot(tray_factory, hsv):
    img = tray_factory({"slot_A": BLUE})
    assert color_fraction(region(img, "slot_A"), hsv["soap"]) > 0.05
    assert color_fraction(region(img, "slot_B"), hsv["soap"]) == 0.0


@pytest.mark.parametrize("slot,color,item", [("slot_B", GREEN, "shampoo"), ("slot_C", YELLOW, "lotion"), ("slot_D", WHITE, "cloth")])
def test_each_item_color_is_separable(tray_factory, hsv, slot, color, item):
    img = tray_factory({slot: color})
    crop = region(img, slot)
    assert color_fraction(crop, hsv[item]) > 0.05
    others = [k for k in hsv if k != item]
    assert all(color_fraction(crop, hsv[o]) < 0.01 for o in others)


def test_color_fraction_empty_crop_is_zero(hsv):
    assert color_fraction(np.zeros((0, 0, 3), np.uint8), hsv["soap"]) == 0.0


def test_hue_wraparound_for_reds():
    red = np.zeros((20, 20, 3), np.uint8)
    red[:] = (30, 30, 220)  # BGR red, hue ≈ 0
    assert color_fraction(red, ((170, 100, 100), (10, 255, 255))) > 0.95


def test_count_blobs(tray_factory, hsv):
    import cv2

    img = tray_factory({})
    cv2.circle(img, (100, 100), 25, BLUE, -1)
    cv2.circle(img, (250, 100), 25, BLUE, -1)
    cv2.circle(img, (400, 100), 3, BLUE, -1)  # too small to count
    assert count_blobs(img, hsv["soap"], min_area=200) == 2


def test_template_score_same_vs_different(tray_factory):
    ref = tray_factory({"slot_A": BLUE})
    same = ref.copy()
    rng = np.random.default_rng(1)
    noisy = np.clip(same.astype(int) + rng.normal(0, 5, same.shape), 0, 255).astype(np.uint8)
    other = tray_factory({"slot_B": BLUE})
    a = region(ref, "slot_A")
    assert template_score(region(noisy, "slot_A"), a) > 0.9
    assert template_score(region(other, "slot_A"), a) < 0.5


def test_hsv_range_from_patch_covers_the_patch():
    from cvlib import hsv_mask

    patch = np.zeros((20, 20, 3), np.uint8)
    patch[:] = BLUE
    lo, hi = hsv_range_from_patch(patch)
    assert np.count_nonzero(hsv_mask(patch, (lo, hi))) == patch.shape[0] * patch.shape[1]
    assert lo[0] <= hi[0]


def test_hsv_range_from_patch_red_wraps():
    patch = np.zeros((20, 20, 3), np.uint8)
    patch[:10] = (30, 30, 220)  # hue ~0
    patch[10:] = (60, 20, 200)  # hue ~175
    lo, hi = hsv_range_from_patch(patch)
    assert lo[0] > hi[0], "red sample should give a wrapping hue range"


def test_template_score_both_empty_slots_match(tray_factory):
    a = region(tray_factory({}), "slot_A")
    assert template_score(a, a.copy()) == 1.0
