"""End-to-end smoke test of the MVP API with synthetic towel images (real model calls).

Run with the edge app up: .venv/bin/python scripts/smoke_mvp.py [http://127.0.0.1:8000]
"""
import base64
import json
import sys
import time

import cv2
import httpx
import numpy as np

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
c = httpx.Client(base_url=BASE, timeout=240)


def towel(stage: str, bunched: bool = False) -> str:
    img = np.full((384, 512, 3), (110, 90, 70), np.uint8)  # dark table
    if stage == "flat":
        cv2.rectangle(img, (56, 100), (456, 300), (245, 245, 245), -1)
    elif stage == "half":
        cv2.rectangle(img, (56, 100), (456, 200), (245, 245, 245), -1)
        cv2.line(img, (56, 200), (456, 200), (200, 200, 200), 3)
    elif stage == "quarter":
        cv2.rectangle(img, (56, 100), (256, 200), (245, 245, 245), -1)
        cv2.line(img, (256, 100), (256, 200), (200, 200, 200), 3)
    if bunched:
        cv2.circle(img, (60, 104), 40, (225, 225, 225), -1)
        cv2.circle(img, (450, 296), 36, (225, 225, 225), -1)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return base64.b64encode(jpg.tobytes()).decode()


def step(name, fn):
    t0 = time.perf_counter()
    try:
        out = fn()
        print(f"[OK]   {name} ({(time.perf_counter()-t0)*1000:.0f} ms)")
        return out
    except Exception as e:
        print(f"[FAIL] {name}: {e}")
        raise


def req(method, path, **kw):
    r = c.request(method, path, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} → {r.status_code}: {r.text[:300]}")
    return r.json()


frames = [towel("flat", bunched=True), towel("flat"), towel("half"), towel("quarter")]
t = step("teach: Claude writes steps", lambda: req("POST", "/teach/steps", json={"title": "Fold a towel the hotel way", "frames": frames}))
print("       steps:", [s["instruction"] for s in t["steps"]])
saved = step("save + Cartesia pre-record", lambda: req("PUT", f"/tasks/{t['task_id']}", json={"title": t["title"], "steps": t["steps"]}))
print("       audio_ok:", saved["audio_ok"], saved.get("audio_error"), f"{saved['audio_ms']} ms")
s = step("start session", lambda: req("POST", "/coach/start", json={"worker_name": "Smoke Test", "task_id": t["task_id"]}))
sid = s["session_id"]
print("       step 1:", s["step"]["instruction"], "| memory:", len(s["memory"]), f"({s['memory_ms']} ms)")
r = step("check: bunched towel on step 1", lambda: req("POST", f"/coach/{sid}/check", json={"image": towel("flat", bunched=True), "trigger": "pause"}))
print("       →", r["status"], r["source"], r["confidence"], r["reason"], f"{r['latency_ms']} ms")
r = step("check: flat towel on step 1", lambda: req("POST", f"/coach/{sid}/check", json={"image": towel("flat"), "trigger": "pause"}))
print("       →", r["status"], r["source"], r["confidence"], r["reason"], f"{r['latency_ms']} ms", "| advanced:", "next" in r)

# talk: synthesize "Is this correct?" with Cartesia, send as the worker's voice
audio = step("tts for talk test", lambda: c.get("/tts", params={"text": "Is this correct?"}).content)
r = step("talk: 'is this correct?'", lambda: req("POST", f"/coach/{sid}/talk", files={"audio": ("talk.mp3", audio, "audio/mpeg")}, data={"image": towel("half")}))
print("       heard:", repr(r["said"]), "intent:", r["intent"], "by:", r["answered_by"], f"{r['latency_ms']} ms", "| answer:", r["answer"][:80])
audio = c.get("/tts", params={"text": "Why do I do this?"}).content
r = step("talk: 'why?' (instant)", lambda: req("POST", f"/coach/{sid}/talk", files={"audio": ("talk.mp3", audio, "audio/mpeg")}, data={"image": ""}))
print("       heard:", repr(r["said"]), "intent:", r["intent"], "| answer:", r["answer"])
h = step("help", lambda: req("POST", f"/coach/{sid}/help", json={"image": towel("half")}))
print("       photo:", h["photo"])
n = step("next by hand", lambda: req("POST", f"/coach/{sid}/next", json={"reason": "button"}))
time.sleep(2)
m = step("memory list (Moss)", lambda: req("GET", "/memory/Smoke Test"))
print("       notes:", [x["text"][:70] for x in m["notes"]][:3], "| error:", m["error"])
rc = step("memory recall", lambda: req("GET", "/memory/Smoke Test/recall", params={"q": t["steps"][0]["instruction"]}))
print("       recall:", [(x["score"], x["text"][:50]) for x in rc["memory"]], f"{rc['latency_ms']} ms")
step("end session", lambda: req("POST", f"/coach/{sid}/end"))

# SpacetimeDB rows
tok = httpx.post("http://127.0.0.1:3000/v1/identity").json()["token"]
counts = {}
for table in ("step_event", "help_request", "talk_event"):
    r = httpx.post("http://127.0.0.1:3000/v1/database/stepwise/sql", headers={"Authorization": f"Bearer {tok}"}, content=f"SELECT * FROM {table} WHERE session_id = '{sid}'")
    counts[table] = len(r.json()[0]["rows"]) if r.status_code == 200 else f"ERR {r.status_code} {r.text[:80]}"
print("[OK]   SpacetimeDB rows:", counts)

# Moss memory path directly: a mistake note, then recall it by meaning from a different task
req("POST", "/memory/Smoke Test", json={"text": "Smoke Test bunches the corners when folding towels."})
rc = step("memory recall by meaning", lambda: req("GET", "/memory/Smoke Test/recall", params={"q": "fold the bedsheet corners neatly"}))
print("       recall:", [(x["score"], x["text"][:60]) for x in rc["memory"]], f"{rc['latency_ms']} ms")
