"""Supervisor video → tasks → steps.

1. Cartesia speech-to-text on the video file itself (word timestamps → sentence segments).
2. Key frames: the sharpest frame in each of ~16 equal windows, faces blurred (YuNet), 768 px wide.
3. Claude reads frames + timed transcript together and returns tasks with steps (PLAN.md step format
   plus start_s/end_s).
4. Each task is saved like a taught task (so Coach and the worker Steps page use it), and its
   instructions, corrections and reasons are pre-recorded.

Uploaded raw videos are deleted after analysis (PLAN.md: no video stored); only the blurred key
frames stay. The bundled demo video is never modified.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("stepwise.video")

YUNET = Path(__file__).resolve().parents[2] / "models" / "face_detection_yunet_2023mar.onnx"
FRAME_W = 768
N_FRAMES = 16


def probe(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("cannot read this video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    seekable = True
    if n <= 0 or fps > 240:
        # browser recordings (MediaRecorder webm) have no frame count, duration or seek index: walk the file
        seekable = False
        n, last_ms = 0, 0.0
        while cap.grab():
            n += 1
            last_ms = cap.get(cv2.CAP_PROP_POS_MSEC) or last_ms
        fps = n / (last_ms / 1000) if last_ms > 0 else 30
    cap.release()
    return {"fps": fps, "frames": int(n), "duration": n / fps if fps else 0, "width": w, "height": h, "seekable": seekable}


def _best_per_window_sequential(path: Path, dur: float, n: int) -> list[tuple[float, np.ndarray]]:
    """No seek index: one pass through the file, sharpest of every 3rd frame in each of n windows."""
    cap = cv2.VideoCapture(str(path))
    best: dict[int, tuple[float, float, np.ndarray]] = {}
    i = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        i += 1
        if i % 3:
            continue
        ok, f = cap.retrieve()
        if not ok:
            continue
        t = (cap.get(cv2.CAP_PROP_POS_MSEC) or 0) / 1000
        k = min(n - 1, int(t / dur * n)) if dur > 0 else 0
        s = _sharp(f)
        if k not in best or s > best[k][1]:
            best[k] = (t, s, f)
    cap.release()
    return [(best[k][0], best[k][2]) for k in sorted(best)]


def _sharp(img: np.ndarray) -> float:
    g = cv2.cvtColor(cv2.resize(img, (256, int(256 * img.shape[0] / img.shape[1]))), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def blur_faces(img: np.ndarray, detector) -> tuple[np.ndarray, int]:
    if detector is None:
        return img, 0
    detector.setInputSize((img.shape[1], img.shape[0]))
    _, faces = detector.detect(img)
    if faces is None:
        return img, 0
    out = img.copy()
    for f in faces:
        x, y, w, h = (int(v) for v in f[:4])
        pad = int(0.08 * max(w, h))  # just the face: big pads hid printed logos on task objects
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        if x1 > x0 and y1 > y0:
            out[y0:y1, x0:x1] = cv2.GaussianBlur(out[y0:y1, x0:x1], (0, 0), 25)
    return out, len(faces)


def key_frames(path: Path, n: int = N_FRAMES) -> tuple[list[tuple[float, bytes]], int]:
    """Sharpest frame from each of n equal windows, face-blurred, JPEG. Returns ([(t, jpg)], faces_blurred)."""
    info = probe(path)
    dur = info["duration"]
    cap = cv2.VideoCapture(str(path))
    detector = cv2.FaceDetectorYN.create(str(YUNET), "", (320, 320), 0.6) if YUNET.exists() else None
    out: list[tuple[float, bytes]] = []
    faces = 0
    picks: list[tuple[float, np.ndarray]] = []
    if info["seekable"]:
        for k in range(n):
            a, b = dur * k / n, dur * (k + 1) / n
            best, best_t, best_s = None, a, -1.0
            for t in np.linspace(a + 0.05, max(a + 0.05, b - 0.05), 5):  # 5 candidates per window
                cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
                ok, f = cap.read()
                if not ok:
                    continue
                s = _sharp(f)
                if s > best_s:
                    best, best_t, best_s = f, float(t), s
            if best is not None:
                picks.append((best_t, best))
    else:
        picks = _best_per_window_sequential(path, dur, n)
    for best_t, best in picks:
        img = cv2.resize(best, (FRAME_W, int(FRAME_W * best.shape[0] / best.shape[1])), interpolation=cv2.INTER_AREA)
        img, nf = blur_faces(img, detector)
        faces += nf
        ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ok:
            out.append((round(best_t, 2), jpg.tobytes()))
    cap.release()
    return out, faces


def segments(words: list, text: str, duration: float) -> list[dict]:
    """Group word timestamps into sentence segments."""
    if not words:
        return [{"start": 0.0, "end": duration, "text": text.strip()}] if text.strip() else []
    segs, cur, start = [], [], None
    for w in words:
        word = getattr(w, "word", "") if not isinstance(w, dict) else w.get("word", "")
        s = getattr(w, "start", None) if not isinstance(w, dict) else w.get("start")
        e = getattr(w, "end", None) if not isinstance(w, dict) else w.get("end")
        if start is None:
            start = s or 0.0
        cur.append(word)
        if re.search(r"[.!?]$", word.strip()):
            segs.append({"start": round(start, 2), "end": round(e or start, 2), "text": "".join(cur).strip()})
            cur, start = [], None
    if cur:
        segs.append({"start": round(start or 0, 2), "end": round(duration, 2), "text": "".join(cur).strip()})
    return segs


class Job:
    def __init__(self, video_id: str, name: str) -> None:
        self.id = "job_" + uuid.uuid4().hex[:10]
        self.video_id = video_id
        self.name = name
        self.stage = "queued"
        self.stages: dict[str, float] = {}
        self.error: str | None = None
        self.result: dict | None = None
        self.started = time.time()
        self._t = time.perf_counter()

    def to(self, stage: str) -> None:
        now = time.perf_counter()
        if self.stage not in ("queued",):
            self.stages[self.stage] = round((now - self._t) * 1000)
        self.stage, self._t = stage, now

    def view(self) -> dict:
        return {"job_id": self.id, "video_id": self.video_id, "name": self.name, "stage": self.stage, "stages_ms": self.stages, "error": self.error, "result": self.result}


def save_analysis(root: Path, video_id: str, data: dict) -> None:
    d = root / "videos" / video_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "analysis.json").write_text(json.dumps(data, indent=2))


def list_analyses(root: Path) -> list[dict]:
    out = []
    for p in sorted((root / "videos").glob("*/analysis.json")):
        a = json.loads(p.read_text())
        out.append({"video_id": a["video_id"], "name": a["name"], "created_at": a["created_at"], "tasks": [{"task_id": t["task_id"], "title": t["title"], "steps": len(t["steps"])} for t in a["tasks"]]})
    return sorted(out, key=lambda a: a["created_at"], reverse=True)
