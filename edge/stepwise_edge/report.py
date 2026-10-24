"""Worker report (supervisor page): measured stats from SpacetimeDB rows, then Claude writes the words.

The browser sends this worker's rows (it already has them through its live subscription); the numbers
here are computed, never generated. Claude only turns them (plus the worker's Moss notes) into plain
language for the job coach and a short, encouraging version for the worker.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime


def _t(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def trend(mistakes_per_attempt: list[int]) -> str:
    """Compare the first and second half of the attempts (oldest first)."""
    if len(mistakes_per_attempt) < 2:
        return "not_enough_data"
    half = len(mistakes_per_attempt) // 2
    early = sum(mistakes_per_attempt[:half]) / half
    late = sum(mistakes_per_attempt[-half:]) / half
    if late < early:
        return "improving"
    if late > early:
        return "more_mistakes_lately"
    return "steady"


def stats(sessions: list[dict], events: list[dict], help_rows: list[dict]) -> dict:
    by_session: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        by_session[e["session_id"]].append(e)
    tasks: dict[str, dict] = {}
    for s in sorted(sessions, key=lambda x: x.get("started_at") or ""):
        t = tasks.setdefault(s["task_id"], {"task_id": s["task_id"], "title": s.get("task_title") or s["task_id"], "attempts": []})
        evs = by_session.get(s["id"], [])
        mistakes = [e for e in evs if e["kind"] == "mistake"]
        start, end = _t(s.get("started_at")), _t(s.get("ended_at"))
        t["attempts"].append({
            "session_id": s["id"],
            "started_at": s.get("started_at"),
            "finished": s.get("status") == "done",
            "steps_done": min(s.get("steps_total") or 10**6, len({e.get("step_id", e.get("step_text")) for e in evs if e["kind"] in ("done", "skipped")})),
            "steps_total": s.get("steps_total", 0),
            "mistakes": len(mistakes),
            "mistake_notes": [{"step": e.get("step_text", ""), "what": e.get("note", "")} for e in mistakes][:20],
            "minutes": round((end - start).total_seconds() / 60, 1) if start and end else None,
        })
    for t in tasks.values():
        per = [a["mistakes"] for a in t["attempts"]]
        steps = Counter(n["step"] for a in t["attempts"] for n in a["mistake_notes"])
        t.update({
            "times_done": len(t["attempts"]),
            "times_finished": sum(a["finished"] for a in t["attempts"]),
            "mistakes_total": sum(per),
            "mistakes_per_attempt": per,
            "trend": trend(per),
            "hardest_steps": [{"step": k, "mistakes": v} for k, v in steps.most_common(3)],
        })
    return {
        "sessions": len(sessions),
        "tasks": list(tasks.values()),
        "mistakes_total": sum(t["mistakes_total"] for t in tasks.values()),
        "help_requests": len(help_rows),
        "help": [{"step": h.get("step_text", ""), "status": h.get("status", ""), "when": h.get("created_at", "")} for h in help_rows][:20],
    }


REPORT_SYSTEM = """You write a progress report for a job coach about one worker, for a job coach app.
The worker is a capable adult with an intellectual or developmental disability. Be warm, specific and honest.
Use only the measured numbers and notes you are given: never invent a number, a task or an event.
If there is little data, say so plainly. Never use "wrong", "failed" or "bad". Say "people with intellectual and
developmental disabilities", never "IDD person". Plain language a busy coach can read in one minute.
"for_worker" is 2-3 short sentences to read to the worker: first-grade reading level, encouraging, one idea each."""

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "needs_support": {"type": "array", "items": {"type": "string"}},
        "improvement": {"type": "string"},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "for_worker": {"type": "string"},
    },
    "required": ["summary", "strengths", "needs_support", "improvement", "recommendations", "for_worker"],
    "additionalProperties": False,
}
