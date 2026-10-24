"""ArUco tray rectification: camera frame -> top-down tray image.

Markers sit on the tray corners: id 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
The output image spans the rectangle between the four marker centers, so keep slots between them.

  python3 rectify.py http://<pi-ip>:8000/snapshot.jpg [--out tray.jpg]
  python3 rectify.py photo.jpg --show
"""
import argparse
import time
import urllib.request

import cv2
import numpy as np

DICTIONARY = cv2.aruco.DICT_4X4_50
DEFAULT_IDS = (0, 1, 2, 3)  # TL, TR, BR, BL
DEFAULT_SIZE = (640, 480)  # (width, height) of the rectified tray

_detector = cv2.aruco.ArucoDetector(
    cv2.aruco.getPredefinedDictionary(DICTIONARY), cv2.aruco.DetectorParameters()
)


def find_markers(frame: np.ndarray) -> dict:
    """Return {marker_id: center (x, y)} for every marker seen."""
    corners, ids, _ = _detector.detectMarkers(frame)
    if ids is None:
        return {}
    return {int(i): c.reshape(4, 2).mean(axis=0) for i, c in zip(ids.ravel(), corners)}


def rectify(frame: np.ndarray, marker_ids=DEFAULT_IDS, size=DEFAULT_SIZE):
    """Top-down tray image, or None when any of the four markers is missing.

    None means "do not check": the coach says "Look at the tray, please" and stays quiet otherwise.
    """
    found = find_markers(frame)
    if any(i not in found for i in marker_ids):
        return None
    w, h = size
    src = np.float32([found[i] for i in marker_ids])
    dst = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    H = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(frame, H, (w, h))


def load(source: str) -> np.ndarray:
    if source.startswith("http"):
        data = urllib.request.urlopen(source, timeout=10).read()
        return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    return cv2.imread(source)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="image path or snapshot URL")
    ap.add_argument("--out", default="tray.jpg")
    ap.add_argument("--show", action="store_true")
    args = ap.parse_args()
    frame = load(args.source)
    t0 = time.perf_counter()
    found = find_markers(frame)
    tray = rectify(frame)
    ms = (time.perf_counter() - t0) * 1000
    print(f"markers seen: {sorted(found)}  ({ms:.1f} ms for detect + rectify)")
    if tray is None:
        print("Look at the tray, please: not all of markers 0-3 are visible")
        return
    cv2.imwrite(args.out, tray)
    print(f"saved {args.out} {tray.shape[1]}x{tray.shape[0]}")
    if args.show:
        cv2.imshow("rectified (any key to close)", tray)
        cv2.waitKey(0)


if __name__ == "__main__":
    main()
