"""Bitdeer vision check (PLAN.md §2): snapshot + reference photo + step text → status JSON.

OpenAI-compatible API at Bitdeer Model Studio. The model is chosen in
config.yaml (models.bitdeer_vision), picked from the kill-test probe.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time

from openai import OpenAI

from .prompts import BITDEER_PROMPT, BITDEER_PROMPT_V2, IMAGES_NO_REF, IMAGES_WITH_REF, STATUS

_client: OpenAI | None = None


def client(base_url: str) -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.getenv("BITDEER_API_KEY", ""), base_url=base_url, timeout=15, max_retries=0)
    return _client


def _url(jpg: bytes) -> dict:
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}}


def parse_check(text: str) -> dict:
    """Pull the status JSON out of a model reply; anything malformed becomes 'unclear'."""
    m = re.search(r"\{[^{}]*\"status\"[^{}]*\}", text, re.S)
    if not m:
        return {"status": "unclear", "confidence": 0.0, "reason": "no answer"}
    try:
        d = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {"status": "unclear", "confidence": 0.0, "reason": "bad answer"}
    status = d.get("status") if d.get("status") in STATUS else "unclear"
    try:
        conf = max(0.0, min(1.0, float(d.get("confidence", 0))))
    except (TypeError, ValueError):
        conf = 0.0
    return {"status": status, "confidence": conf, "reason": str(d.get("reason", ""))[:160], "box": parse_box(d.get("box")), "fix": str(d.get("fix") or "")[:200]}


def parse_box(b) -> list[float] | None:
    """[x, y, w, h] as fractions of the snapshot; tolerates pixel boxes (assumes the 512 px snapshot)."""
    if not isinstance(b, (list, tuple)) or len(b) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in b)
    except (TypeError, ValueError):
        return None
    if max(x, y, w, h) > 1.5:  # pixels, not fractions
        x, y, w, h = x / 512, y / 512, w / 512, h / 512
    x, y = min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)
    w, h = min(max(w, 0.0), 1.0 - x), min(max(h, 0.0), 1.0 - y)
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)] if w > 0.01 and h > 0.01 else None


def build_v2(step: dict, task: dict | None, has_ref: bool) -> str:
    steps = (task or {}).get("steps", [])
    idx = next((i for i, s in enumerate(steps) if s.get("id") == step.get("id")), 0)
    before = "; ".join(s["instruction"] for s in steps[:idx]) or "none (this is the first step)"
    return BITDEER_PROMPT_V2.format(
        task=(task or {}).get("title", "a work task"),
        n=idx + 1,
        total=len(steps) or 1,
        instruction=step.get("instruction", ""),
        before=before,
        done_right=step.get("done_right", ""),
        common_mistake=step.get("common_mistake", ""),
        images=IMAGES_WITH_REF if has_ref else IMAGES_NO_REF,
    )


def check(base_url: str, model: str, snapshot: bytes, ref: bytes | None, step: dict, task: dict | None = None, prompt: str = "v2") -> tuple[dict, float]:
    if prompt == "v2":
        content: list = [{"type": "text", "text": build_v2(step, task, ref is not None)}]
        if ref:
            content.append(_url(ref))
        content.append(_url(snapshot))
        t0 = time.perf_counter()
        r = client(base_url).chat.completions.create(model=model, messages=[{"role": "user", "content": content}], max_tokens=4000, temperature=0)  # thinking models need room before the JSON
        return parse_check(r.choices[0].message.content or ""), (time.perf_counter() - t0) * 1000
    # v1 (kept for comparison): reference-photo style prompt
    step_text = f"Step: {step.get('instruction', '')}\nDone right: {step.get('done_right', '')}\nCommon mistake: {step.get('common_mistake', '')}"
    content: list = [{"type": "text", "text": BITDEER_PROMPT.format(step=step_text)}]
    if ref:
        content.append(_url(ref))
    else:
        content[0]["text"] = content[0]["text"].replace("Image 1 is the reference photo: the step done right. Image 2 is the worker now.", "The image is the worker now.")
    content.append(_url(snapshot))
    t0 = time.perf_counter()
    r = client(base_url).chat.completions.create(model=model, messages=[{"role": "user", "content": content}], max_tokens=800, temperature=0)
    ms = (time.perf_counter() - t0) * 1000
    return parse_check(r.choices[0].message.content or ""), ms
