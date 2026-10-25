"""Live step check: one model, Claude Sonnet (models.claude_live), on every streamed frame.

One snapshot + the WHOLE step list → which steps are finished, the current step's
status, and (for a mistake) where it is and the fix, in a single call. Seeing every step
lets the model map what the worker is doing to the right step, even if they move ahead quickly.
"""
from __future__ import annotations

import base64
import json
import time

from .prompts import IMAGES_NO_REF, IMAGES_WITH_REF, LIVE_PROMPT, LIVE_SCHEMA, STATUS

_claude = None


def build_prompt(step: dict, task: dict | None, has_ref: bool) -> str:
    steps = (task or {}).get("steps", []) or [step]
    idx = next((i for i, s in enumerate(steps) if s.get("id") == step.get("id")), 0)
    lines = "\n".join(
        f"{i + 1}. {'[DONE] ' if i < idx else ''}{s.get('instruction', '')}\n   Done when: {s.get('done_right', '')}\n   Common mistake: {s.get('common_mistake', '')}"
        for i, s in enumerate(steps)
    )
    return LIVE_PROMPT.format(
        task=(task or {}).get("title", "a work task"),
        steps=lines,
        n=idx + 1,
        total=len(steps),
        instruction=step.get("instruction", ""),
        images=IMAGES_WITH_REF if has_ref else IMAGES_NO_REF,
    )


def box_from_2d(b) -> list[float] | None:
    """[ymin, xmin, ymax, xmax] on a 0–1000 scale → [x, y, w, h] fractions."""
    if not isinstance(b, (list, tuple)) or len(b) != 4:
        return None
    try:
        y0, x0, y1, x1 = (min(max(float(v), 0.0), 1000.0) / 1000 for v in b)
    except (TypeError, ValueError):
        return None
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    w, h = x1 - x0, y1 - y0
    return [round(x0, 4), round(y0, 4), round(w, 4), round(h, 4)] if w > 0.01 and h > 0.01 else None


def parse(d: dict, total: int) -> dict:
    status = d.get("status") if d.get("status") in STATUS else "unclear"
    try:
        conf = max(0.0, min(1.0, float(d.get("confidence", 0))))
    except (TypeError, ValueError):
        conf = 0.0
    try:
        through = max(0, min(total, int(d.get("done_through", 0))))
    except (TypeError, ValueError):
        through = 0
    return {
        "status": status,
        "confidence": conf,
        "reason": str(d.get("reason", ""))[:160],
        "done_through": through,
        "box": box_from_2d(d.get("box_2d")) if status == "mistake" else None,
        "fix": str(d.get("fix") or "")[:200] if status == "mistake" else "",
        "seen": str(d.get("seen", ""))[:200],
        "hint": str(d.get("hint") or "")[:200],
    }


def _claude_call(model: str, effort: str, prompt: str, images: list[bytes]) -> dict:
    global _claude
    import anthropic

    if _claude is None:
        _claude = anthropic.Anthropic(max_retries=0)  # a stale live answer is worthless: the next frame is already coming
    content: list = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(b).decode()}} for b in images]
    content.append({"type": "text", "text": prompt})
    kwargs: dict = {
        "model": model,
        "max_tokens": 2000,
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": LIVE_SCHEMA}},
        "messages": [{"role": "user", "content": content}],
    }
    if model.startswith(("claude-sonnet-5-5", "claude-opus-5", "claude-fable-5")):
        # server-side refusal fallback (Haiku has none)
        r = _claude.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
    else:
        r = _claude.messages.create(**kwargs)
    if r.stop_reason == "refusal":
        raise RuntimeError("Claude declined this request")
    return json.loads(next((b.text for b in r.content if b.type == "text"), "{}"))


def source_of(model: str) -> str:
    return next((k for k in ("sonnet", "haiku") if k in model), "claude")


def check(models: dict, snapshot: bytes, ref: bytes | None, step: dict, task: dict | None) -> tuple[dict, float, str]:
    """Returns (result, latency_ms, source), source = 'sonnet' for the default claude_live."""
    total = len((task or {}).get("steps", [])) or 1
    images = ([ref] if ref else []) + [snapshot]
    t0 = time.perf_counter()
    raw = _claude_call(models["claude_live"], models.get("claude_live_effort", "low"), build_prompt(step, task, ref is not None), images)
    return parse(raw, total), (time.perf_counter() - t0) * 1000, source_of(models["claude_live"])
