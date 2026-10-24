"""Does the live check judge the step's GOAL, or just match the example photo?

Labeled frames from videos/supervisor.mp4, each also tested in altered versions (rotation +
colour shift, zoom + mirror) to imitate a different camera/setting. Compares prompt versions and
models; writes eval/results/live_prompt.json. Run: .venv/bin/python scripts/eval_live_prompt.py
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "edge"))
from stepwise_edge import vision  # noqa: E402
from stepwise_edge.config import load_config  # noqa: E402
from stepwise_edge.tasks import TaskStore  # noqa: E402

cfg = load_config()
BASE = cfg["models"]["bitdeer_base_url"]
store = TaskStore(ROOT / "data")
task = store.get(json.load(open(ROOT / "data/videos/demo_supervisor/analysis.json"))["tasks"][0]["task_id"])

# (time_s, step index 0-based, truth) — checked by eye against the video
LABELS = [
    (2.0, 0, "in_progress"),   # cup still on the table
    (9.0, 0, "done"),          # holding the coffee cup
    (11.7, 1, "done"),         # sleeve held with words right side up
    (21.0, 1, "mistake"),      # sleeve held upside down
    (13.3, 2, "in_progress"),  # sleeve next to the cup, not on yet
    (17.25, 2, "done"),        # sleeve on the cup, middle
    (18.0, 3, "done"),         # sleeve on, words upright
    (22.5, 3, "mistake"),      # sleeve on, upside down
    (24.0, 3, "mistake"),      # sleeve on, upside down
    (5.0, 3, "in_progress"),   # nothing done yet (cup on table)
]


def frame(t):
    cap = cv2.VideoCapture(str(ROOT / "videos/supervisor.mp4"))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    W = int(__import__('os').environ.get('SNAP_PX', '768'))
    return cv2.resize(f, (W, int(W * f.shape[0] / f.shape[1])))


def variants(img):
    h, w = img.shape[:2]
    rot = cv2.warpAffine(img, cv2.getRotationMatrix2D((w / 2, h / 2), 9, 1.08), (w, h), borderMode=cv2.BORDER_REFLECT)
    hsv = cv2.cvtColor(rot, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[..., 0] = (hsv[..., 0] + 12) % 180
    hsv[..., 2] = np.clip(hsv[..., 2] * 0.8 + 10, 0, 255)
    recolor = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    zoom = cv2.resize(img[int(h * 0.12): int(h * 0.92), int(w * 0.15): int(w * 0.9)], (w, h))
    return {"original": img, "rotated_recolored": recolor, "zoomed_mirrored": cv2.flip(zoom, 1)}


jpg = lambda im: cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()  # noqa: E731
cases = []
for t, si, truth in LABELS:
    for vname, im in variants(frame(t)).items():
        cases.append({"t": t, "step": si, "truth": truth, "variant": vname, "jpg": jpg(im)})

CONFIGS = [(m, p, ref) for m, p, ref in [
    ("Qwen/Qwen3.8-27B", "v1", True),
    ("Qwen/Qwen3.8-27B", "v2", True),
    ("Qwen/Qwen3.8-27B", "v2", False),
    ("deepseek-ai/DeepSeek-V4.1-Flash", "v2", True),
    ("zai-org/GLM-5.3-Flash", "v2", True),
] if not sys.argv[1:] or m.split("/")[-1] in sys.argv[1:]]


def run_one(model, prompt, use_ref, c):
    st = task["steps"][c["step"]]
    ref = store.frame(task["task_id"], st["reference_photo"]) if use_ref else None
    try:
        r, ms = vision.check(BASE, model, c["jpg"], ref, st, task, prompt=prompt)
    except Exception as e:
        r, ms = {"status": "error", "reason": type(e).__name__}, 0
    return {**{k: c[k] for k in ("t", "step", "truth", "variant")}, "got": r["status"], "conf": r.get("confidence"), "reason": r.get("reason"), "ms": round(ms)}


report = []
for model, prompt, use_ref in CONFIGS:
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(lambda c: run_one(model, prompt, use_ref, c), cases))
    n = len(rows)
    acc = sum(r["got"] == r["truth"] for r in rows) / n
    done_rows = [r for r in rows if r["truth"] == "done"]
    done_hit = sum(r["got"] == "done" for r in done_rows) / len(done_rows)
    mis_rows = [r for r in rows if r["truth"] == "mistake"]
    mis_hit = sum(r["got"] == "mistake" for r in mis_rows) / len(mis_rows)
    false_corr = sum(r["got"] == "mistake" and r["truth"] != "mistake" for r in rows) / n
    by_var = {v: sum(r["got"] == r["truth"] for r in rows if r["variant"] == v) / sum(1 for r in rows if r["variant"] == v) for v in ("original", "rotated_recolored", "zoomed_mirrored")}
    lat = sorted(r["ms"] for r in rows if r["ms"])
    name = f"{model.split('/')[-1]} · prompt {prompt} · {'with' if use_ref else 'no'} example photo"
    report.append({"config": name, "accuracy": acc, "done_recognized": done_hit, "mistakes_caught": mis_hit, "false_corrections": false_corr, "by_variant": by_var, "p50_ms": lat[len(lat) // 2] if lat else None, "rows": rows})
    print(f"{name:62} acc {acc:4.0%} | done seen {done_hit:4.0%} | mistakes caught {mis_hit:4.0%} | false corr {false_corr:4.0%} | orig {by_var['original']:.0%} rot {by_var['rotated_recolored']:.0%} zoom {by_var['zoomed_mirrored']:.0%} | p50 {report[-1]['p50_ms']} ms", flush=True)

(ROOT / "eval/results/live_prompt.json").write_text(json.dumps({"ran_at": time.strftime("%Y-%m-%d %H:%M:%S"), "n_cases": len(cases), "report": report}, indent=2))
