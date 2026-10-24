"""Claude: teach mode (step list from key frames), unclear checks, open questions.

All calls: claude-opus-5-5 with structured JSON output, server-side refusal
fallbacks ("default"), and a stop_reason check before reading content.
"""
from __future__ import annotations

import base64
import json
import time

import anthropic

from .prompts import ANSWER_SYSTEM, CHECK_SCHEMA, JUDGE_SYSTEM, TEACH_SCHEMA, TEACH_SYSTEM, VIDEO_SCHEMA, VIDEO_SYSTEM, LOCATE_SCHEMA, LOCATE_SYSTEM

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from .env
    return _client


def _img(jpg: bytes) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(jpg).decode()}}


def _call(model: str, effort: str, system: str, content: list, schema: dict | None, max_tokens: int = 16000) -> tuple[dict | str, float]:
    t0 = time.perf_counter()
    kwargs: dict = {"effort": effort}
    if schema:
        kwargs["format"] = {"type": "json_schema", "schema": schema}
    # Streamed so large max_tokens never hits the SDK's long-request guard; we only need the final message.
    with client().beta.messages.stream(
        model=model,
        max_tokens=max_tokens,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        output_config=kwargs,
        messages=[{"role": "user", "content": content}],
    ) as stream:
        r = stream.get_final_message()
    ms = (time.perf_counter() - t0) * 1000
    if r.stop_reason == "refusal":
        raise RuntimeError("Claude declined this request")
    text = next((b.text for b in r.content if b.type == "text"), "")
    return (json.loads(text) if schema else text.strip()), ms


def teach_steps(model: str, effort: str, frames: list[bytes], title_hint: str) -> tuple[dict, float]:
    content: list = [{"type": "text", "text": f"Task name from the supervisor: {title_hint or '(not given)'}. Key frames follow, in time order."}]
    for i, jpg in enumerate(frames):
        content += [{"type": "text", "text": f"Frame {i}"}, _img(jpg)]
    content.append({"type": "text", "text": "Write the step list."})
    out, ms = _call(model, effort, TEACH_SYSTEM, content, TEACH_SCHEMA, max_tokens=32000)
    return out, ms


def judge(model: str, effort: str, snapshots: list[bytes], ref: bytes | None, step: dict) -> tuple[dict, float]:
    content: list = [{"type": "text", "text": _step_text(step)}]
    if ref:
        content += [{"type": "text", "text": "Reference photo (step done right):"}, _img(ref)]
    for i, s in enumerate(snapshots):
        content += [{"type": "text", "text": f"Worker snapshot {i + 1} of {len(snapshots)} (newest last):"}, _img(s)]
    return _call(model, effort, JUDGE_SYSTEM, content, CHECK_SCHEMA, max_tokens=4000)


def answer(model: str, effort: str, question: str, frame: bytes | None, task_title: str, step: dict, step_no: int, total: int) -> tuple[str, float]:
    content: list = [{"type": "text", "text": f"Task: {task_title}. The worker is on step {step_no} of {total}.\n{_step_text(step)}\nThe worker asked: \"{question}\""}]
    if frame:
        content += [{"type": "text", "text": "What the glasses see right now:"}, _img(frame)]
    out, ms = _call(model, effort, ANSWER_SYSTEM, content, None, max_tokens=4000)
    return str(out), ms


def _step_text(step: dict) -> str:
    return (
        f"Step instruction: {step.get('instruction', '')}\n"
        f"Done right looks like: {step.get('done_right', '')}\n"
        f"Common mistake: {step.get('common_mistake', '')}"
    )


def video_tasks(model: str, effort: str, frames: list[tuple[float, bytes]], transcript: list[dict], duration: float) -> tuple[dict, float]:
    """frames: [(time_s, jpeg)], transcript: [{start, end, text}] sentence-level segments."""
    lines = "\n".join(f"[{s['start']:.1f}–{s['end']:.1f}s] {s['text']}" for s in transcript) or "(no speech)"
    content: list = [{"type": "text", "text": f"Video length: {duration:.1f} s.\nTranscript:\n{lines}\n\nKey frames follow, in time order."}]
    for i, (t, jpg) in enumerate(frames):
        content += [{"type": "text", "text": f"Frame {i} at {t:.1f}s"}, _img(jpg)]
    content.append({"type": "text", "text": "Break this video into tasks and steps."})
    return _call(model, effort, VIDEO_SYSTEM, content, VIDEO_SCHEMA, max_tokens=32000)


def locate(model: str, effort: str, snapshot: bytes, step: dict, reason: str) -> tuple[dict, float]:
    """Where is the mistake? Used to draw the on-screen mark after a check said 'mistake'."""
    content: list = [{"type": "text", "text": f"{_step_text(step)}\nThe mistake seen: {reason}"}, _img(snapshot)]
    return _call(model, effort, LOCATE_SYSTEM, content, LOCATE_SCHEMA, max_tokens=4000)
