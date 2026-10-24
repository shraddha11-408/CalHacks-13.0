"""Kill-test 3: one Bitdeer vision call on a test image, with latency.

The Bitdeer catalog doesn't say which models take images, so we probe every
chat model with the same rectified tray image (a blue block in slot A) and a
question with a known answer. Records which models can see, their answer and
latency. Pass = at least one model answers correctly.
"""
import base64
import json
import re
import time

import cv2
import numpy as np
import yaml
from openai import OpenAI

from common import OUT, ROOT, env, pctl, record

cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
SKIP = ("bge", "reranker", "seedream")  # embeddings / image generation

# Test image: rectified tray canvas with a blue "soap" in slot_A.
w, h = cfg["workspace"]["rectified_size"]
img = np.full((h, w, 3), 235, np.uint8)
for name, (nx, ny, nw, nh) in cfg["workspace"]["slots"].items():
    x0, y0, x1, y1 = int(nx * w), int(ny * h), int((nx + nw) * w), int((ny + nh) * h)
    cv2.rectangle(img, (x0, y0), (x1, y1), (120, 120, 120), 3)
    cv2.putText(img, name[-1], (x0 + 12, y0 + 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (150, 150, 150), 2)
ax, ay, aw, ah = cfg["workspace"]["slots"]["slot_A"]
cx, cy = int((ax + aw / 2) * w), int((ay + ah / 2) * h)
cv2.rectangle(img, (cx - 70, cy - 40), (cx + 70, cy + 40), (200, 90, 30), -1)  # BGR blue
cv2.imwrite(str(OUT / "bitdeer_test.jpg"), img)
ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
data_url = "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode()

client = OpenAI(api_key=env("BITDEER_API_KEY"), base_url=cfg["models"]["bitdeer_base_url"], timeout=60)
PROMPT = 'This is a top-down photo of a tray with four slots labeled A, B, C, D. Which slot holds the blue object? Reply with JSON only: {"slot": "A|B|C|D"}'

models = [m.id for m in client.models.list().data if not any(s in m.id.lower() for s in SKIP)]
results = {}
for model in models:
    t0 = time.perf_counter()
    try:
        r = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            max_tokens=400,
            temperature=0,
        )
        ms = (time.perf_counter() - t0) * 1000
        text = (r.choices[0].message.content or "").strip()
        m = re.search(r'"slot"\s*:\s*"([ABCD])"', text)
        results[model] = {"ok": True, "answer": m.group(1) if m else None, "raw": text[:120], "latency_ms": round(ms), "tokens": getattr(r.usage, "total_tokens", None)}
    except Exception as e:  # a text-only model rejects image input
        ms = (time.perf_counter() - t0) * 1000
        results[model] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:140]}", "latency_ms": round(ms)}
    print(model, json.dumps(results[model])[:220])

correct = {m: r for m, r in results.items() if r.get("answer") == "A"}
t = {}
extra = {"models": results}
if correct:
    best = min(correct, key=lambda m: correct[m]["latency_ms"])
    # A few more calls on the fastest correct model for a rough latency spread
    lat = [correct[best]["latency_ms"]]
    for _ in range(4):
        t0 = time.perf_counter()
        client.chat.completions.create(model=best, messages=[{"role": "user", "content": [
            {"type": "text", "text": PROMPT}, {"type": "image_url", "image_url": {"url": data_url}}]}], max_tokens=400, temperature=0)
        lat.append((time.perf_counter() - t0) * 1000)
    t = {"best_p50": pctl(lat, 50), "best_max": max(lat)}
    extra["best_model"] = best
    names = ", ".join(f"{m.split('/')[-1]} {r['latency_ms']}ms" for m, r in correct.items())
    raise SystemExit(record("bitdeer", "pass", f"vision OK on {len(correct)}/{len(models)} models ({names}); fastest {best}", t, extra))
raise SystemExit(record("bitdeer", "fail", f"no model answered the vision probe correctly ({len(models)} tried)", t, extra))
