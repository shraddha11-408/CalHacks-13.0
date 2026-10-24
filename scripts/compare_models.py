"""Compare Bitdeer vision models (and Claude) on the labeled test set (PLAN.md build order, Fri night).

Test set layout (eval/test_set/, gitignored photos are fine to keep local):
  labels.csv  columns: file,task_id,step_id,label      label = done | mistake | in_progress
  <file>.jpg  snapshots taken from the Coach page (face-blurred, work-area crop)

Prints accuracy, false-correction rate (said "mistake" when it wasn't), p50/p99 latency,
and writes eval/results/model_compare.json. Only numbers from this file get quoted.

  .venv/bin/python scripts/compare_models.py [--models m1,m2] [--claude]
"""
import argparse
import csv
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "edge"))
from stepwise_edge import claude, vision  # noqa: E402
from stepwise_edge.config import load_config  # noqa: E402
from stepwise_edge.tasks import TaskStore  # noqa: E402

cfg = load_config()
ap = argparse.ArgumentParser()
ap.add_argument("--models", default=f"{cfg['models']['bitdeer_vision']},{cfg['models']['bitdeer_vision_alt']}")
ap.add_argument("--claude", action="store_true", help="also run Claude on every snapshot")
args = ap.parse_args()

TS = ROOT / "eval" / "test_set"
rows = list(csv.DictReader(open(TS / "labels.csv"))) if (TS / "labels.csv").exists() else []
if not rows:
    sys.exit(f"No labels at {TS / 'labels.csv'} (columns: file,task_id,step_id,label)")
store = TaskStore(ROOT / "data")


def pct(xs, p):
    s = sorted(xs)
    return s[min(int(len(s) * p), len(s) - 1)] if s else None


def run(name, fn):
    res = {"model": name, "n": 0, "correct": 0, "false_corrections": 0, "unclear": 0, "lat": []}
    for r in rows:
        task = store.get(r["task_id"])
        step = next(s for s in task["steps"] if str(s["id"]) == str(r["step_id"]))
        ref = store.frame(r["task_id"], step["reference_photo"])
        snap = (TS / r["file"]).read_bytes()
        try:
            out, ms = fn(snap, ref, step)
        except Exception as e:
            out, ms = {"status": "unclear"}, 0
            print(f"  {name} error on {r['file']}: {type(e).__name__}")
        res["n"] += 1
        res["lat"].append(ms)
        got = out["status"]
        res["correct"] += got == r["label"]
        res["unclear"] += got == "unclear"
        res["false_corrections"] += got == "mistake" and r["label"] != "mistake"
    lat = res.pop("lat")
    res.update(accuracy=res["correct"] / res["n"], false_correction_rate=res["false_corrections"] / res["n"], p50_ms=pct(lat, 0.5), p99_ms=pct(lat, 0.99))
    return res


results = []
for m in [x for x in args.models.split(",") if x]:
    results.append(run(f"bitdeer:{m}", lambda s, ref, st, m=m: vision.check(cfg["models"]["bitdeer_base_url"], m, s, ref, st)))
if args.claude:
    M = cfg["models"]
    results.append(run(f"claude:{M['claude']}", lambda s, ref, st: claude.judge(M["claude"], M["claude_effort_judge"], [s], ref, st)))

print(f"\n{'model':48} {'acc':>6} {'false-corr':>10} {'unclear':>8} {'p50':>8} {'p99':>8}")
for r in results:
    print(f"{r['model']:48} {r['accuracy']:6.0%} {r['false_correction_rate']:10.0%} {r['unclear']:8d} {r['p50_ms']:8.0f} {r['p99_ms']:8.0f}")
out = ROOT / "eval" / "results"
out.mkdir(parents=True, exist_ok=True)
(out / "model_compare.json").write_text(json.dumps({"ran_at": time.strftime("%Y-%m-%d %H:%M:%S"), "n": len(rows), "results": results}, indent=2))
print(f"\nwrote {out / 'model_compare.json'}")
