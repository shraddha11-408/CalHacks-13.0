"""Progress you can hear: after a session, SpacetimeDB's numbers + one Moss detail → a short spoken summary.

The numbers are counted here from SpacetimeDB rows (never generated). Claude only words them, warmly,
for a first-grade reading level; if Claude is unavailable a template says the same facts.
"""
from __future__ import annotations

from collections import defaultdict


def _micros(v) -> int | None:
    """SpacetimeDB SQL JSON: a timestamp is [micros]; an option is [0, [value]] (some) or [1, []] (none)."""
    if isinstance(v, list):
        if len(v) == 1 and isinstance(v[0], int):
            return v[0]
        if len(v) == 2 and v[0] == 0:
            return _micros(v[1])
        return None
    return v if isinstance(v, int) else None


def session_numbers(sid: str, sessions: list[dict], events: list[dict], titles: dict[str, str], total_steps: int) -> dict:
    """sessions/events: this worker's rows (dicts by column name). Same task = same title (re-teaching makes new ids)."""
    me = next((s for s in sessions if s["id"] == sid), None)
    if not me:
        return {}
    title = titles.get(me["task_id"], me["task_id"])
    by_session: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        by_session[e["session_id"]].append(e)

    def summarize(s: dict) -> dict:
        evs = by_session.get(s["id"], [])
        done = {e["step_id"] for e in evs if e["kind"] == "done"}
        moved_by_hand = {e["step_id"] for e in evs if e["kind"] == "skipped"}
        trouble = {e["step_id"] for e in evs if e["kind"] in ("mistake", "help")}
        start, end = _micros(s.get("started_at")), _micros(s.get("ended_at"))
        return {
            "steps_done": len(done | moved_by_hand),
            "by_self": len(done - trouble - moved_by_hand),  # the camera saw it done, with no correction and no help
            "corrections": sum(e["kind"] == "mistake" for e in evs),
            "help": sum(e["kind"] == "help" for e in evs),
            "minutes": round((end - start) / 60e6, 1) if start and end and end > start else None,
            "finished": s.get("status") == "done",
            "started": start or 0,
        }

    now = summarize(me)
    earlier = sorted(
        (summarize(s) for s in sessions if s["id"] != sid and titles.get(s["task_id"], s["task_id"]) == title and (_micros(s.get("started_at")) or 0) < now["started"]),
        key=lambda x: x["started"],
    )
    earlier = [e for e in earlier if e["steps_done"]]  # tries that never got going don't count as "last time"
    last = earlier[-1] if earlier else None
    return {
        "task": title,
        "total_steps": total_steps,
        **{k: now[k] for k in ("steps_done", "by_self", "corrections", "help", "minutes", "finished")},
        "times_done": len(earlier) + 1,
        "last_time": {k: last[k] for k in ("by_self", "corrections", "minutes", "finished")} if last else None,
    }


LEVEL_NAMES = ["full instructions", "a short reminder", "help only if something needs fixing", "doing it on your own"]


def template(name: str, n: dict) -> str:
    """Facts only, no model: used when Claude is unavailable."""
    if not n:
        return "Good work today!"
    parts = []
    if n["by_self"]:
        parts.append(f"You did {n['by_self']} step{'s' if n['by_self'] != 1 else ''} by yourself today!")
    elif n["steps_done"]:
        parts.append(f"You did {n['steps_done']} step{'s' if n['steps_done'] != 1 else ''} today!")
    if n.get("level_ups"):
        parts.append("You know a step so well that I can say less now!")
    last = n.get("last_time")
    if last and n["corrections"] < last["corrections"]:
        parts.append("You needed fewer reminders than last time.")
    elif last and n["minutes"] and last["minutes"] and n["minutes"] < last["minutes"]:
        parts.append("You were faster than last time.")
    parts.append(f"Great work, {name}!" if n["finished"] else "Keep practicing. You are getting better!")
    return " ".join(parts)


PROGRESS_SYSTEM = """You talk to a worker in their job-coach glasses, right after they practiced a task. The worker is
a capable adult with an intellectual or developmental disability. Write what the coach says out loud:
2 or 3 short sentences, under 35 words in total. First-grade reading level. One idea per sentence.
Start with the best true number, like "You did 3 steps by yourself today!".
If there is a "last_time", say one honest, positive thing about the change (fewer reminders, faster, finished).
If "level_ups" is not empty, celebrate it: the worker needs less help on that step now (say which step,
in a few plain words). This is the biggest win of the day.
You may use one memory note to name something that used to be hard and went better today, but only if today's
numbers show it. Never invent a number, a step or an event. Never say "wrong", "no", "failed" or "bad".
If today was harder, stay warm: name what they did do and say they are learning. Plain text only."""
