"""Kill-test 2: ArUco detection + rectified top-down tray image.

Synthetic: the printed test mat, seen in perspective at ~50 cm on a 640x480
camera with blur + noise → detect all 4 markers → rectify → slot corners land
within a few px of where config.yaml says they are.
Live: grab webcam frames; report which markers are visible. If all 4 are in
view (hold up the printed props/aruco_tray.pdf page 4), save the rectified image.

Pass = synthetic passes AND live sees all 4. Partial = synthetic only.
"""
import time

import cv2
import numpy as np
import yaml

from common import OUT, ROOT, pctl, record
from cvlib import detect, rectify

cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
ws = cfg["workspace"]
SIZE = tuple(ws["rectified_size"])
IDS = tuple(ws["marker_ids"])
t: dict[str, float] = {}

# ---------- synthetic ----------
mat = cv2.imread(str(ROOT / "props" / "aruco_test_mat.png"))
if mat is None:
    raise SystemExit(record("aruco", "fail", "props/aruco_test_mat.png missing — run scripts/make_aruco_pdf.py"))
H0, W0 = mat.shape[:2]
# Test mat on a table seen from a head-mounted camera ~50 cm away, tilted.
src = np.float32([[0, 0], [W0, 0], [W0, H0], [0, H0]])
dst = np.float32([[150, 95], [505, 120], [560, 400], [85, 380]])
P = cv2.getPerspectiveTransform(src, dst)
scene = np.full((480, 640, 3), 90, np.uint8)  # grey table
warped = cv2.warpPerspective(mat, P, (640, 480), dst=scene.copy(), borderMode=cv2.BORDER_TRANSPARENT)
warped = cv2.GaussianBlur(warped, (3, 3), 0.8)
rng = np.random.default_rng(0)
warped = np.clip(warped.astype(np.int16) + rng.normal(0, 6, warped.shape), 0, 255).astype(np.uint8)
cv2.imwrite(str(OUT / "aruco_synthetic_input.jpg"), warped)

lat = []
rect = None
for _ in range(30):
    t0 = time.perf_counter()
    rect = rectify(warped, IDS, SIZE)
    lat.append((time.perf_counter() - t0) * 1000)
t["detect_rectify_p50"] = pctl(lat, 50)
t["detect_rectify_p99"] = pctl(lat, 99)

if rect is None:
    found = sorted(detect(warped))
    raise SystemExit(record("aruco", "fail", f"synthetic: rectify failed, markers found {found}", t))
cv2.imwrite(str(OUT / "aruco_synthetic_rectified.jpg"), rect)

# Ground truth: where slot_A's top-left corner should be in rectified space,
# vs. where the mat's slot_A corner actually lands (project mat px → rectified).
m = int(4.5 * 300 / 2.54)
margin = int(1.0 * 300 / 2.54)
inner = np.float32([[margin + m, margin + m], [W0 - margin - m, margin + m], [W0 - margin - m, H0 - margin - m], [margin + m, H0 - margin - m]])
cw, ch = inner[1, 0] - inner[0, 0], inner[3, 1] - inner[0, 1]
errs = []
for name, (nx, ny, nw, nh) in ws["slots"].items():
    for fx, fy in [(nx, ny), (nx + nw, ny + nh)]:
        mat_pt = np.float32([[inner[0, 0] + fx * cw, inner[0, 1] + fy * ch]])
        img_pt = cv2.perspectiveTransform(mat_pt[None], P)[0]
        # map image point through the same homography rectify() used
        found = detect(warped)
        srcq = np.float32([found[mid][(k + 2) % 4] for k, mid in enumerate(IDS)])
        dstq = np.float32([[0, 0], [SIZE[0] - 1, 0], [SIZE[0] - 1, SIZE[1] - 1], [0, SIZE[1] - 1]])
        Hr = cv2.getPerspectiveTransform(srcq, dstq)
        got = cv2.perspectiveTransform(img_pt[None], Hr)[0, 0]
        want = np.float32([fx * (SIZE[0] - 1), fy * (SIZE[1] - 1)])
        errs.append(float(np.linalg.norm(got - want)))
max_err = max(errs)
synthetic_ok = max_err < 8.0 and t["detect_rectify_p99"] < 50

# ---------- live ----------
cap = cv2.VideoCapture(cfg["devices"]["webcam_index"], cv2.CAP_AVFOUNDATION)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
seen: set[int] = set()
live_rect = None
for _ in range(45):  # ~1.5 s
    ok, frame = cap.read()
    if not ok:
        continue
    seen |= set(detect(frame)) & set(IDS)  # ignore stray markers in the room
    r = rectify(frame, IDS, SIZE)
    if r is not None:
        live_rect = r
        break
cap.release()
if live_rect is not None:
    cv2.imwrite(str(OUT / "aruco_live_rectified.jpg"), live_rect)

extra = {"slot_corner_max_err_px": round(max_err, 2), "live_markers_seen": sorted(seen), "live_rectified": live_rect is not None}
detail = f"synthetic {'OK' if synthetic_ok else 'BAD'} (slot error ≤ {max_err:.1f}px); live saw markers {sorted(seen) or 'none'}"
if not synthetic_ok:
    raise SystemExit(record("aruco", "fail", detail, t, extra))
if live_rect is None:
    raise SystemExit(record("aruco", "partial", detail + " — hold up printed page 4 to finish", t, extra))
raise SystemExit(record("aruco", "pass", detail + " — live rectified saved", t, extra))
