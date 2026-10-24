"""Fast live check (live_vision: Gemini Flash / Claude Haiku) on the same labeled frames as
eval_live_prompt.py, so the numbers compare with Bitdeer. Writes eval/results/live_fast.json.
Run: .venv/bin/python scripts/eval_live_fast.py [claude] [gemini]
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
from stepwise_edge import live_vision  # noqa: E402
from stepwise_edge.config import load_config  # noqa: E402
from stepwise_edge.tasks import TaskStore  # noqa: E402

cfg = load_config()
M, C = cfg["models"], cfg["coach"]
store = TaskStore(ROOT / "data")
task = store.get(json.load(open(ROOT / "data/videos/demo_supervisor/analysis.json"))["tasks"][0]["task_id"])

# Same frames as eval_live_prompt.py: (time_s, step index 0-based, truth), for the 3-step task
# (cup / sleeve upright / slide on). The old 4th "check the words" step is part of step 3 now.
LABELS = [
    (2.0, 0, "in_progress"), (9.0, 0, "done"), (11.7, 1, "done"), (21.0, 1, "mistake"), (13.3, 2, "in_progress"),
    (17.25, 2, "done"), (18.0, 2, "done"), (22.5, 2, "mistake"), (24.0, 2, "mistake"), (5.0, 2, "in_progress"),
]


def frame(t):
    cap = cv2.VideoCapture(str(ROOT / "videos/supervisor.mp4"))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    _, f = cap.read()
    W = next((int(a[5:]) for a in sys.argv if a.startswith("--px=")), C["live_snapshot_px"])
    return cv2.resize(f, (W, int(W * f.shape[0] / f.shape[1])))


def variants(img):
    h, w = img.shape[:2]
    rot = cv2.warpAffine(img, cv2.getRotationMatrix2D((w / 2, h / 2), 9, 1.08), (w, h), borderMode=cv2.BORDER_REFLECT)
    hsv = cv2.cvtColor(rot, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[..., 0] = (hsv[..., 0] + 12) % 180
    hsv[..., 2] = np.clip(hsv[..., 2] * 0.8 + 10, 0, 255)
    zoom = cv2.resize(img[int(h * 0.12): int(h * 0.92), int(w * 0.15): int(w * 0.9)], (w, h))
    return {"original": img, "rotated_recolored": cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR), "zoomed_mirrored": cv2.flip(zoom, 1)}


jpg = lambda im: cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()  # noqa: E731
cases = [{"t": t, "step": si, "truth": truth, "variant": v, "jpg": jpg(im)} for t, si, truth in LABELS for v, im in variants(frame(t)).items()]


def run_one(models, c):
    st = task["steps"][c["step"]]
    ref = store.frame(task["task_id"], st["reference_photo"]) if models.get("live_send_ref", True) else None
    try:
        r, ms, _ = live_vision.check(models, c["jpg"], ref, st, task)
        got = r["status"]
        # same rule as api.run_check: the model saw this step finished
        if got in ("in_progress", "unclear") and r["done_through"] >= c["step"] + 1 and r["confidence"] >= C["done_confidence"]:
            got = "done"
        # same rule as CoachSession.classify: low confidence counts as unclear
        if (got == "mistake" and r["confidence"] < C["low_confidence"]) or (got == "done" and r["confidence"] < C["done_confidence"]):
            got = "unclear"
    except Exception as e:
        r, ms, got = {"reason": f"{type(e).__name__}: {str(e)[:120]}"}, 0, "error"
    return {**{k: c[k] for k in ("t", "step", "truth", "variant")}, "got": got, "through": r.get("done_through"), "conf": r.get("confidence"), "reason": r.get("reason"), "box": r.get("box"), "ms": round(ms)}


report = []
for arg in [a for a in sys.argv[1:] if not a.startswith("--")] or ["claude"]:  # provider[:model[:effort-or-thinking-level]]
    prov, model, level = (arg.split(":") + [None, None])[:3]
    models = {**M, "live_vision": prov}
    if model:
        models["gemini_live" if prov == "gemini" else "claude_live"] = model
    if level:
        models["gemini_thinking" if prov == "gemini" else "claude_live_effort"] = level
    if "--ref" in sys.argv:
        models["live_send_ref"] = True
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(lambda c: run_one(models, c), cases))
    n = len(rows)
    acc = sum(r["got"] == r["truth"] for r in rows) / n
    done_hit = sum(r["got"] == "done" for r in rows if r["truth"] == "done") / sum(r["truth"] == "done" for r in rows)
    mis_hit = sum(r["got"] == "mistake" for r in rows if r["truth"] == "mistake") / sum(r["truth"] == "mistake" for r in rows)
    false_corr = sum(r["got"] == "mistake" and r["truth"] != "mistake" for r in rows) / n
    lat = sorted(r["ms"] for r in rows if r["ms"])
    p50, p90 = (lat[len(lat) // 2], lat[int(len(lat) * 0.9)]) if lat else (None, None)
    name = ("ref · " if models.get("live_send_ref") else "") + f"{prov} ({models['gemini_live'] if prov == 'gemini' else models['claude_live']}, {models['gemini_thinking'] if prov == 'gemini' else models['claude_live_effort']})"
    report.append({"config": name, "accuracy": acc, "done_recognized": done_hit, "mistakes_caught": mis_hit, "false_corrections": false_corr, "p50_ms": p50, "p90_ms": p90, "errors": sum(r["got"] == "error" for r in rows), "rows": rows})
    print(f"{name:34} acc {acc:4.0%} | done seen {done_hit:4.0%} | mistakes caught {mis_hit:4.0%} | false corr {false_corr:4.0%} | p50 {p50} ms p90 {p90} ms | errors {report[-1]['errors']}", flush=True)

(ROOT / "eval/results/live_fast.json").write_text(json.dumps({"ran_at": time.strftime("%Y-%m-%d %H:%M:%S"), "n_cases": len(cases), "report": report}, indent=2))
