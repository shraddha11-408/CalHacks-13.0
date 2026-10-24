"""Generate props/aruco_tray.pdf (US Letter, print at 100% / "actual size").

Sizing for a 40–60 cm camera distance: a 640 px webcam sees ~75 cm across at
60 cm (~8.5 px/cm). A 6 cm DICT_4X4_50 marker is ~50 px there, ~8 px per cell,
comfortably above OpenCV's detection floor. Each marker keeps a 1 cm white
quiet zone; don't trim into it.

Pages:
  1. Tray corner markers 0–3 (6 cm), cut out and tape on the tray corners.
  2. Slot labels A–D.
  3. The "done" mark.
  4. Test mat: one sheet with all 4 markers + slots, for testing without a tray.

Also writes props/aruco_test_mat.png (page 4 as an image) for the synthetic kill-test.
"""
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CFG = yaml.safe_load((ROOT / "config.yaml").read_text())["workspace"]
DPI = 300
CM = DPI / 2.54
PAGE = (int(8.5 * DPI), int(11 * DPI))  # portrait letter
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
DICT = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, CFG["aruco_dict"]))
CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"]
ITEMS = {"A": "Blue soap", "B": "Green shampoo", "C": "Yellow lotion", "D": "Folded washcloth"}


def font(px: float, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(BOLD if bold else REG, int(px))


def marker(mid: int, size_px: int) -> Image.Image:
    return Image.fromarray(cv2.aruco.generateImageMarker(DICT, mid, size_px)).convert("RGB")


def cutline(d: ImageDraw.ImageDraw, box):
    x0, y0, x1, y1 = box
    for x in range(int(x0), int(x1), 40):
        d.line([(x, y0), (min(x + 20, x1), y0)], fill=(150, 150, 150), width=3)
        d.line([(x, y1), (min(x + 20, x1), y1)], fill=(150, 150, 150), width=3)
    for y in range(int(y0), int(y1), 40):
        d.line([(x0, y), (x0, min(y + 20, y1))], fill=(150, 150, 150), width=3)
        d.line([(x1, y), (x1, min(y + 20, y1))], fill=(150, 150, 150), width=3)


def header(d, title, sub):
    d.text((1.5 * CM, 1.2 * CM), title, font=font(0.9 * CM), fill="black")
    d.text((1.5 * CM, 2.4 * CM), sub, font=font(0.45 * CM, False), fill=(60, 60, 60))


def page_markers() -> Image.Image:
    img = Image.new("RGB", PAGE, "white")
    d = ImageDraw.Draw(img)
    header(d, "Stepwise tray markers (6 cm)", "Print at 100% / actual size. Check: the ruler below is 10 cm. Keep the white border.")
    # 10 cm ruler for print-scale check
    y = 3.4 * CM
    d.line([(1.5 * CM, y), (11.5 * CM, y)], fill="black", width=6)
    for i in range(11):
        x = 1.5 * CM + i * CM
        d.line([(x, y - 0.3 * CM), (x, y + 0.3 * CM)], fill="black", width=4)
    m = int(6 * CM)
    q = int(1 * CM)
    cell = m + 2 * q
    origin = (int(1.5 * CM), int(4.8 * CM))
    for k in range(4):
        cx = origin[0] + (k % 2) * (cell + int(1.2 * CM))
        cy = origin[1] + (k // 2) * (cell + int(2.2 * CM))
        cutline(d, (cx, cy, cx + cell, cy + cell))
        img.paste(marker(k, m), (cx + q, cy + q))
        d.text((cx, cy + cell + 0.25 * CM), f"ID {k} · tray {CORNER_NAMES[k]}", font=font(0.5 * CM), fill="black")
    for i, line in enumerate([
        "Tape each marker on the tray rim at its corner, flat, printed side up, just outside the work area.",
        "0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left, as the worker sees the tray.",
    ]):
        d.text((1.5 * CM, (25.6 + i * 0.7) * CM), line, font=font(0.4 * CM, False), fill=(60, 60, 60))
    return img


def page_slots() -> Image.Image:
    img = Image.new("RGB", PAGE, "white")
    d = ImageDraw.Draw(img)
    header(d, "Slot labels", "Cut out and place one label in each slot.")
    w, h = int(8.5 * CM), int(9.5 * CM)
    for k, (letter, item) in enumerate(ITEMS.items()):
        x = int(1.5 * CM) + (k % 2) * (w + int(1 * CM))
        y = int(4 * CM) + (k // 2) * (h + int(1 * CM))
        cutline(d, (x, y, x + w, y + h))
        d.text((x + w / 2, y + h * 0.42), letter, font=font(5.5 * CM), fill="black", anchor="mm")
        d.text((x + w / 2, y + h * 0.85), item, font=font(0.75 * CM), fill="black", anchor="mm")
    return img


def page_done() -> Image.Image:
    img = Image.new("RGB", PAGE, "white")
    d = ImageDraw.Draw(img)
    header(d, "Done mark", "Tape at the table edge where finished trays go.")
    x0, y0, x1, y1 = 1.5 * CM, 6 * CM, PAGE[0] - 1.5 * CM, 14 * CM
    d.rounded_rectangle((x0, y0, x1, y1), radius=int(0.6 * CM), outline="black", width=int(0.25 * CM))
    d.text(((x0 + x1) / 2, (y0 + y1) / 2), "DONE", font=font(4.5 * CM), fill="black", anchor="mm")
    d.text(((x0 + x1) / 2, y1 + 1.2 * CM), "Slide the tray here.", font=font(0.9 * CM), fill="black", anchor="mm")
    return img


def page_test_mat() -> Image.Image:
    """Landscape mat: markers at the corners, slots from config.yaml between them."""
    W, H = PAGE[1], PAGE[0]
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    m = int(4.5 * CM)
    margin = int(1.0 * CM)
    for k, (x, y) in enumerate([(margin, margin), (W - margin - m, margin), (W - margin - m, H - margin - m), (margin, H - margin - m)]):
        img.paste(marker(k, m), (x, y))
    # Rectified canvas = inner marker corners; config slots are normalized to it.
    cx0, cy0, cx1, cy1 = margin + m, margin + m, W - margin - m, H - margin - m
    cw, ch = cx1 - cx0, cy1 - cy0
    for name, (nx, ny, nw, nh) in CFG["slots"].items():
        letter = name[-1]
        x, y = cx0 + nx * cw, cy0 + ny * ch
        d.rounded_rectangle((x, y, x + nw * cw, y + nh * ch), radius=30, outline=(90, 90, 90), width=8)
        d.text((x + nw * cw / 2, y + nh * ch / 2), letter, font=font(1.6 * CM), fill=(170, 170, 170), anchor="mm")
        d.text((x + nw * cw / 2, y + nh * ch / 2 + 1.3 * CM), ITEMS[letter], font=font(0.42 * CM), fill=(120, 120, 120), anchor="mm")
    d.text((W / 2, H - 0.5 * CM), "Stepwise test mat · markers 4.5 cm · print at 100%", font=font(0.35 * CM, False), fill=(120, 120, 120), anchor="mm")
    return img


def main():
    out = ROOT / "props"
    mat = page_test_mat()
    pages = [page_markers(), page_slots(), page_done(), mat]
    pages[0].save(out / "aruco_tray.pdf", save_all=True, append_images=pages[1:], resolution=DPI)
    mat.save(out / "aruco_test_mat.png")
    print(f"wrote {out / 'aruco_tray.pdf'} (4 pages) and {out / 'aruco_test_mat.png'}")


if __name__ == "__main__":
    main()
