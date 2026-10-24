"""Make printable ArUco markers (DICT_4X4_50) for the tray corners.

  python3 aruco_markers.py [--size-cm 7] [--outdir markers]

Writes marker_0..3.png and tray_markers_a4.png (all four on one A4 page at 300 DPI, true size).
Print at 100% scale (no "fit to page") and check the printed marker edge with a ruler.
Corner order on the tray: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
"""
import argparse
import os

import cv2
import numpy as np

from rectify import DICTIONARY

DPI = 300
A4_PX = (int(8.27 * DPI), int(11.69 * DPI))  # (w, h)
CORNER_NAMES = {0: "top-left", 1: "top-right", 2: "bottom-right", 3: "bottom-left"}


def marker_image(marker_id: int, px: int) -> np.ndarray:
    return cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTIONARY), marker_id, px)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size-cm", type=float, default=7.0, help="printed marker edge, including its black border")
    ap.add_argument("--outdir", default="markers")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    px = round(args.size_cm / 2.54 * DPI)
    quiet = px // 6  # one marker cell of white margin, which the detector needs
    cell = px + 2 * quiet
    sheet = np.full((A4_PX[1], A4_PX[0]), 255, np.uint8)
    cols = max(1, (A4_PX[0] - 40) // (cell + 40))
    if (4 + cols - 1) // cols * (cell + 120) + 60 > A4_PX[1]:
        raise SystemExit(f"--size-cm {args.size_cm:g} is too big to fit four markers on A4; try 7 or less")
    for i in range(4):
        m = cv2.copyMakeBorder(marker_image(i, px), quiet, quiet, quiet, quiet, cv2.BORDER_CONSTANT, value=255)
        cv2.imwrite(os.path.join(args.outdir, f"marker_{i}.png"), m)
        x = 20 + (i % cols) * (cell + 40)
        y = 60 + (i // cols) * (cell + 120)
        sheet[y:y + cell, x:x + cell] = m
        cv2.putText(sheet, f"id {i}  {CORNER_NAMES[i]}", (x, y + cell + 45),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, 0, 2)
    cv2.putText(sheet, f"Print at 100%. Marker edge = {args.size_cm:g} cm", (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2)
    out = os.path.join(args.outdir, "tray_markers_a4.png")
    cv2.imwrite(out, sheet)
    print(f"wrote {out} and marker_0..3.png in {args.outdir}/  ({px} px = {args.size_cm:g} cm at {DPI} DPI)")


if __name__ == "__main__":
    main()
