"""MVP HTTP API (PLAN.md): teach, coach, talk, help, memory.

Every model call runs off the event loop with a timeout. The database is
written fire-and-forget. If a model is slow or down, the worker can still say
"done" or press Next, so the demo never freezes.
"""
from __future__ import annotations

import asyncio
import contextvars
from pathlib import Path
import base64
import json
import logging
import time
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import claude, live_vision, progress, report, vision
from .agent import WS as AGENT_WS, CartesiaAgent
from .coach import CoachSession, intent_of, spoken_tip
from .config import ROOT, load_config
from .memory import Memory, slug
from .stdb import Stdb
from .tasks import TaskStore, task_id_for
from .voice import PHRASES, PRAISE_KEYS, Voice, VoiceRegistry, speech_clip

log = logging.getLogger("stepwise.api")
CFG = load_config()
COACH = CFG["coach"]
M = CFG["models"]
DATA = ROOT / "data"

router = APIRouter()
store = TaskStore(DATA)
voice = Voice(DATA / "audio")
memory = Memory(DATA / "moss")
voices = VoiceRegistry(DATA / "voices.json")
agent = CartesiaAgent(DATA / "cartesia_agent.json")
# The voice this request speaks in: the task's consented clone of its supervisor, else the stock voice.
# Set once per session request (_sess / coach_start); asyncio tasks and to_thread copy it.
CURRENT_VOICE: contextvars.ContextVar[str | None] = contextvars.ContextVar("voice", default=None)


def task_voice(task: dict) -> str | None:
    return voices.resolve((task.get("voice") or {}).get("id"))
sessions: dict[str, CoachSession] = {}
ended: dict[str, CoachSession] = {}  # recently ended, for the spoken progress summary
# Called with the session id whenever a help request goes out (button, voice or wrist); main.py adds the wrist node's.
HELP_SENT_HOOKS: list = []
_stdb: Stdb | None = None


def stdb() -> Stdb:
    global _stdb
    if _stdb is None:
        _stdb = Stdb(CFG, DATA / "stdb_identity.json")
    return _stdb


def b64jpg(s: str) -> bytes:
    if "," in s[:64]:
        s = s.split(",", 1)[1]
    data = base64.b64decode(s)
    if not data.startswith(b"\xff\xd8"):
        raise HTTPException(400, "expected a JPEG image")
    return data


def say(text: str, cached_only: bool = False) -> dict:
    """A phrase to speak in this request's voice: cached clip URL if present, else an on-demand TTS URL."""
    v = CURRENT_VOICE.get() or voices.default_id()  # never the stock voice while a clone exists
    if voice.path(text, v).exists():
        return {"text": text, "url": voice.url(text, v)}
    from urllib.parse import quote

    return {"text": text, "url": None if cached_only else f"/tts?text={quote(text)}" + (f"&voice={quote(v)}" if v else "")}


def save_photo(kind: str, sid: str, jpg: bytes) -> str:
    d = DATA / "photos" / sid
    d.mkdir(parents=True, exist_ok=True)
    name = f"{kind}_{int(time.time() * 1000)}.jpg"
    (d / name).write_bytes(jpg)
    return f"/files/photos/{sid}/{name}"


async def run_model(fn, *args, timeout: float | None = None):
    return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout or COACH["check_timeout_s"])


# ---------- public config ----------
@router.get("/public-config")
def public_config(task_id: str | None = None) -> dict:
    v = voices.default_id()
    if task_id:
        try:
            v = task_voice(store.get(task_id))
        except Exception:
            pass
    tok = CURRENT_VOICE.set(v)
    try:
        phrases = {k: say(p) for k, p in PHRASES.items()}
    finally:
        CURRENT_VOICE.reset(tok)
    return {"coach": COACH, "spacetimedb": stdb().public(), "voice_id": v, "phrases": phrases}


async def startup() -> None:
    """Called from the app lifespan. Pre-records fixed phrases; never blocks startup on the network."""
    async def go():
        try:
            await asyncio.to_thread(voice.ensure_many, list(PHRASES.values()), voices.default_id())
        except Exception as e:
            voice.error = f"{type(e).__name__}: {str(e)[:120]}"
            log.warning("phrase pre-record failed: %s", e)

    asyncio.create_task(go())
    asyncio.create_task(asyncio.to_thread(stdb))


@router.get("/tts")
async def tts(text: str, voice_id: str | None = Query(None, alias="voice")):
    if not text.strip() or len(text) > 400:
        raise HTTPException(400, "text must be 1–400 characters")
    voice_id = voices.resolve(voice_id)  # only consented clones speak; stock voice only if none exist
    try:
        await asyncio.to_thread(voice.ensure, text, voice_id)
    except Exception as e:
        raise HTTPException(503, f"voice unavailable: {type(e).__name__}")
    return FileResponse(voice.path(text, voice_id), media_type="audio/mpeg")


# ---------- teach ----------
class TeachReq(BaseModel):
    title: str = ""
    frames: list[str]  # base64 JPEGs, face-blurred in the browser, time order


@router.post("/teach/steps")
async def teach_steps(req: TeachReq) -> dict:
    if not 1 <= len(req.frames) <= COACH["keyframes_max"]:
        raise HTTPException(400, f"send 1–{COACH['keyframes_max']} key frames")
    frames = [b64jpg(f) for f in req.frames]
    task_id = task_id_for(req.title or "task")
    urls = store.save_frames(task_id, frames)
    try:
        out, ms = await run_model(claude.teach_steps, M["claude"], M["claude_effort_teach"], frames, req.title, timeout=180)
    except Exception as e:
        raise HTTPException(502, f"Claude could not write the steps: {type(e).__name__}: {str(e)[:160]}")
    steps = []
    for i, s in enumerate(out["steps"]):
        ref = s.pop("reference_frame", 0)
        s["id"] = i + 1
        s["reference_photo"] = urls[max(0, min(int(ref), len(urls) - 1))]
        steps.append(s)
    task = {"task_id": task_id, "title": req.title or out.get("title", "Task"), "steps": steps, "frames": urls, "saved": False}
    store.save(task)
    return {**task, "latency_ms": round(ms)}


class SaveTaskReq(BaseModel):
    title: str
    steps: list[dict]


@router.put("/tasks/{task_id}")
async def save_task(task_id: str, req: SaveTaskReq) -> dict:
    task = store.get(task_id)
    if not task:
        raise HTTPException(404, "no such task")
    keep = ("instruction", "done_right", "common_mistake", "correction", "why", "praise", "cue", "reference_photo")
    flags = ("close_look",)
    steps = []
    for s in req.steps:
        if not str(s.get("instruction", "")).strip():
            continue
        row = {"id": len(steps) + 1, **{k: str(s.get(k, "")) for k in keep}, **{k: bool(s[k]) for k in flags if k in s}}
        for k in ("start_s", "end_s"):  # video timing (Video breakdown tasks)
            if isinstance(s.get(k), (int, float)):
                row[k] = float(s[k])
        steps.append(row)
    if not steps:
        raise HTTPException(400, "a task needs at least one step")
    task.update(title=req.title.strip() or task["title"], steps=steps, saved=True)
    store.save(task)
    stdb().call("save_task", task_id, task["title"], json.dumps(steps))
    # Pre-record every instruction, correction and reason so playback is instant.
    texts = [t for s in steps for t in (s["instruction"], s["correction"], s["why"], s.get("praise", ""), s.get("cue", "")) if t]
    t0 = time.perf_counter()
    try:
        await asyncio.to_thread(voice.ensure_many, texts, task_voice(task))
        audio_ok, audio_err = True, None
    except Exception as e:
        audio_ok, audio_err = False, f"{type(e).__name__}: {str(e)[:120]}"
    return {**task, "audio_ok": audio_ok, "audio_error": audio_err, "audio_ms": round((time.perf_counter() - t0) * 1000)}


@router.get("/tasks")
def list_tasks() -> list[dict]:
    return store.list()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> dict:
    import shutil

    d = store.dir(task_id)
    if not (d / "task.json").exists():
        raise HTTPException(404, "no such task")
    shutil.rmtree(d)
    stdb().call("delete_task", task_id)
    return {"deleted": task_id}


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    t = store.get(task_id)
    if not t:
        raise HTTPException(404, "no such task")
    return t


# ---------- coach ----------
class StartReq(BaseModel):
    worker_name: str
    task_id: str


async def _levels(s: CoachSession) -> dict[int, int] | None:
    """Support levels from SpacetimeDB (the authority). None on any problem: the caller keeps what it had,
    and a step nobody has measured yet is level 0 (full support), which is always safe."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(stdb().mastery_levels, s.worker_id, s.task["task_id"]), 0.4)
    except Exception as e:
        log.info("support levels unavailable, keeping current: %s", type(e).__name__)
        return None


MEMORY_WAIT_S = 1.5


async def step_payload(s: CoachSession) -> dict:
    st = s.step
    fresh = await _levels(s)  # a coach's override takes effect from the next step
    if fresh is not None:
        s.levels = fresh
    lvl = s.level_of()
    # a worker's first start loads their Moss index from the cloud: don't let it hold up the step
    mems, ms = await memory.recall(s.worker_id, f"{st['instruction']}. {st['common_mistake']}", wait_s=MEMORY_WAIT_S)
    speak = []
    if lvl <= 1:  # levels 2–3 (alerts only, independent): no instruction; the screen still shows it
        tip = next((m for m in mems if m.get("kind") == "mistake" and m.get("tip")), None)
        if tip:
            phrase = spoken_tip(tip["tip"])
            if phrase:
                speak.append(say(phrase))
        speak.append(say(st["instruction"] if lvl == 0 else (st.get("cue") or st["instruction"])))
    s.last_said = " ".join(x["text"] for x in speak)
    s.note_spoken([x["text"] for x in speak])
    return {
        "session_id": s.id,
        "index": s.step_index,
        "total": len(s.steps),
        "step": st,
        "say": speak,
        "memory": mems,
        "memory_ms": round(ms, 2),
        "finished": s.finished,
        "level": lvl,
        "levels": {str(k): v for k, v in s.levels.items()},
    }


@router.post("/coach/start")
async def coach_start(req: StartReq) -> dict:
    task = store.get(req.task_id)
    if not task or not task.get("steps"):
        raise HTTPException(404, "no such task (teach and save it first)")
    wid = slug(req.worker_name)
    s = CoachSession(worker_id=wid, worker_name=req.worker_name.strip() or "Worker", task=task)
    sessions[s.id] = s
    CURRENT_VOICE.set(task_voice(task))
    stdb().call("upsert_worker", wid, s.worker_name)
    stdb().call("start_session", s.id, wid, task["task_id"])
    s.levels = await _levels(s) or {}
    if any(not st.get("cue") for st in task["steps"]):
        asyncio.create_task(_safe(_backfill_cues(task, s)))  # older tasks: write level-1 cues, never blocks the start
    return {**await step_payload(s), "task": {"task_id": task["task_id"], "title": task["title"]}, "worker_id": wid}


async def _backfill_cues(task: dict, s: CoachSession | None = None) -> None:
    """Tasks taught before fading existed have no short cue per step: write them once, save, pre-record."""
    cues, ms = await run_model(claude.cues, M["claude_answer"], "low", task["title"], [st["instruction"] for st in task["steps"]], timeout=20)
    if len(cues) != len(task["steps"]):
        return
    for st, cue in zip(task["steps"], cues):
        if not st.get("cue"):
            st["cue"] = cue
    store.save(task)
    stdb().call("save_task", task["task_id"], task["title"], json.dumps(task["steps"]))
    if s is not None:  # the running session uses them from the next step
        for st, cue in zip(s.task["steps"], cues):
            st.setdefault("cue", cue)
    await asyncio.to_thread(voice.ensure_many, cues, task_voice(task))
    log.info("wrote cues for %s in %d ms: %s", task["task_id"], ms, cues)


def _sess(sid: str) -> CoachSession:
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404, "session ended or unknown")
    CURRENT_VOICE.set(task_voice(s.task))
    return s


def log_event(s: CoachSession, kind: str, source: str, trigger: str, conf: float, ms: float, note: str, photo: str = "") -> None:
    stdb().call("log_step_event", s.id, s.worker_id, s.task["task_id"], s.step["id"], kind, source, trigger, float(conf), int(ms), note[:200], photo)


def _praise(s: CoachSession, step: dict) -> list[dict]:
    """Reinforcement: a rotating "Great job!" plus what they did ("You picked up the cup!") when the step has it."""
    lvl = s.level_of(step)
    if lvl >= 2:
        return []  # alerts-only / independent: no running commentary; level-ups get celebrated instead
    generic = say(PHRASES[PRAISE_KEYS[s.praise_i % len(PRAISE_KEYS)]])
    s.praise_i += 1
    specific = (step.get("praise") or "").strip()
    if lvl == 1:
        return [say(specific)] if specific else [generic]  # shorter at the cue level
    return [generic, say(specific)] if specific else [generic]


async def _advance(s: CoachSession, source: str, trigger: str, steps: int = 1) -> dict:
    """Move on `steps` steps (more than 1 when the live check saw the worker already further along)."""
    done_step = s.step
    finished = False
    finished_steps = []
    for k in range(max(1, steps)):
        finished_steps.append(s.step)
        if k:  # skipped ahead: the camera saw this step done too, so it counts (progress, reports)
            log_event(s, "done", source, trigger, 1.0, 0, "already done (seen with the step before)")
        finished = s.advance()
        if finished:
            break
    # Fading: SpacetimeDB applies the promote/step-back rules atomically (fire and forget).
    by_hand = source in ("button", "system")
    for st_done in finished_steps:
        stdb().call("record_step_outcome", s.id, s.worker_id, s.task["task_id"], int(st_done["id"]), s.outcome(st_done["id"], by_hand))
    stdb().call("set_step", s.id, s.step_index)
    praise = _praise(s, done_step)
    if finished:
        stdb().call("end_session", s.id, "done")
        return {"finished": True, "say": praise + [say(PHRASES["all_done"])], "completed_step": done_step["id"]}
    nxt = await step_payload(s)
    nxt["say"] = praise + ([say(PHRASES["next_step"])] if nxt["say"] else []) + nxt["say"]
    return {"finished": False, "next": nxt, "say": nxt["say"], "completed_step": done_step["id"]}


AUTO_TRIGGERS = {"stream", "pause", "left_area", "timeout", "confirm"}  # "stuck"/"voice"/"button" = the worker asked


def _through(result: dict, n: int) -> int:
    """The live check sees every step: a high "done_through" means the current step (n) is done too."""
    through = max(n - 1, int(result.get("done_through", 0) or 0))  # earlier steps stay done: never go back
    if result.get("status") in ("in_progress", "unclear") and through >= n and result.get("confidence", 0) >= COACH["done_confidence"]:
        result["status"] = "done"
    return through


def _stale(trigger: str) -> dict:
    return {"status": "stale", "confidence": 0, "reason": "step changed while checking", "source": "system", "latency_ms": 0, "escalated": False, "trigger": trigger, "say": []}


async def run_check(s: CoachSession, jpg: bytes, trigger: str) -> dict:
    s.snapshots.append(jpg)
    st = s.step
    step_at_start = s.step_index  # the live stream keeps several checks in flight
    ref = store.frame(s.task["task_id"], st.get("reference_photo", "")) if st.get("reference_photo") else None
    # One model for every live check: Claude Sonnet (models.claude_live) sees the frame + the whole step
    # list. Bitdeer is paused (p50 ~8 s was too slow to follow a worker); to switch back, call
    # run_model(vision.check, M["bitdeer_base_url"], M["bitdeer_vision"], jpg, ref, st, s.task) here.
    asked = trigger not in AUTO_TRIGGERS  # the worker asked ("is this right?", "I'm stuck", Check now)
    source, failed = live_vision.source_of(M["claude_live"]), False
    t0 = time.perf_counter()
    try:
        result, ms, source = await run_model(live_vision.check, M, jpg, ref if M.get("live_send_ref", True) else None, st, s.task, timeout=COACH["live_timeout_s"])
    except Exception as e:
        log.warning("live check failed: %s", str(e)[:200])
        limited = "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e) or type(e).__name__ == "RateLimitError"
        result, ms, failed = {"status": "unclear", "confidence": 0.0, "reason": "Rate limited, slowing down" if limited else f"Live check unavailable ({type(e).__name__})"}, (time.perf_counter() - t0) * 1000, True
        if limited:
            return {**_stale(trigger), "status": "rate_limited", "reason": result["reason"], "latency_ms": round(ms)}
    if s.step_index != step_at_start or s.finished:
        return _stale(trigger)  # another check already moved the worker on; this answer is about an old step
    n = s.step_index + 1
    through = _through(result, n)
    status = s.classify(result, COACH["low_confidence"], COACH["done_confidence"])
    if failed and asked:
        status = "unavailable"
    escalated = False  # no Claude judge on the live path: unclear → quiet (auto) or "not sure" (asked)
    # Debounce "done" (AGENTS.md §6): automatic checks advance on 2 dones in a row, >= done_min_gap_s apart.
    if status == "done" and asked:
        s.done_through = through  # the worker asked: one look is enough
    elif status == "done" and result.get("confidence", 0) >= COACH["done_sure"]:
        s.done_through = through  # one sure look is enough (speed); less sure answers wait for a second look
    elif status == "done":
        # how far to jump: the smaller of the two confirming looks, never less than this step
        s.done_through = min(s.done_through, through) if s.done_streak else through
        if not s.note_done(time.monotonic(), COACH["done_confirm"], COACH["done_min_gap_s"]):
            status = "confirming"
    elif status != "unclear":  # hands in the way says nothing; don't throw away a pending "done"
        s.not_done()
    # Grace after a new step: frames from the hand-over moment shouldn't trigger a correction.
    if status == "mistake" and not asked and time.monotonic() - s.step_started_at < COACH["step_grace_s"]:
        status = "in_progress"
    # Debounce corrections (AGENTS.md §6): 2 mistakes in a row, then at most one correction per 10 s.
    # An explicit "is this correct?" / Check-now always answers.
    say_it = "speak"
    if status == "mistake":
        if trigger in AUTO_TRIGGERS:
            need = CFG["thresholds"]["correct_wrong_count"] + (1 if s.level_of() >= 3 else 0)
            say_it = s.note_mistake(time.monotonic(), need, CFG["thresholds"]["correction_cooldown_s"])
        if say_it == "wait":
            status = "in_progress"  # one look is not enough to correct someone
    else:
        s.not_mistake()
    photo = save_photo("check", s.id, jpg) if status == "mistake" and say_it == "speak" else ""
    kind = "mistake_repeat" if status == "mistake" and say_it == "quiet" else {"unavailable": "unclear", "confirming": "in_progress"}.get(status, status)
    log_event(s, kind, source, trigger, result.get("confidence", 0), ms, result.get("reason", ""), photo)  # "mistake" = one spoken correction
    box = result.get("box") if status == "mistake" else None  # live_vision returns [x, y, w, h] fractions
    out: dict = {"status": status, "confidence": result.get("confidence", 0), "reason": result.get("reason", ""), "source": source, "latency_ms": round(ms), "escalated": escalated, "trigger": trigger, "say": [], "box": box, "fix": (result.get("fix") or st["correction"]) if status == "mistake" else "", "photo": photo, "step_index": s.step_index, "repeat": status == "mistake" and say_it == "quiet", "hint": (result.get("hint") or "").strip()}
    if status == "done":
        out.update(await _advance(s, source, trigger, steps=max(1, s.done_through - s.step_index)))
    elif status == "mistake" and say_it == "quiet":
        pass  # already corrected moments ago: keep the mark on screen, don't nag
    elif status == "mistake":
        # the model's fix names what it actually sees ("Put the can down. Pick the cup with the white lid.")
        fix = (result.get("fix") or "").strip()
        correction = (fix if fix.lower().startswith("almost") else f"Almost. {fix}") if fix else st["correction"]
        out["say"] = [say(correction)]
        s.flag("corrections")
        meta = {"kind": "mistake", "task_id": s.task["task_id"], "task": s.task["title"], "step_id": st["id"], "tip": correction}
        text = f"{s.worker_name} had trouble with \"{st['instruction']}\" while doing {s.task['title']}: {result.get('reason') or st['common_mistake']}"
        asyncio.create_task(_safe(memory.add(s.worker_id, text, meta)))
        note_trouble(s, "correction", result.get("reason") or st["common_mistake"], correction)
    elif status == "unavailable" and trigger in ("voice", "button"):
        # demo never freezes: an explicit "done" moves on when the models can't answer
        out.update(await _advance(s, "system", trigger))
        out["status"] = "skipped"
    elif asked and status == "unclear":
        out["say"] = [say(PHRASES["not_sure"])]
    elif status in ("in_progress", "unclear") and trigger in AUTO_TRIGGERS and time.monotonic() - s.last_correction_at > 8:
        # stuck on this step for a while: gentle, escalating guidance (each level once per step;
        # not right after a correction, which already told them what to do)
        lvl = s.level_of()
        scale = COACH["stuck_scale_by_level"][min(lvl, 3)]
        level = s.stuck_due(time.monotonic(), [x * scale for x in COACH["stuck_after_s"]])
        hint = say(out["hint"]) if out["hint"] else say(st["instruction"])
        if level is not None and lvl >= 3:
            out["say"] = [say(PHRASES["offer_help"])]  # independent: only ever offer a person
        elif level == 0:
            out["say"] = [say(PHRASES["take_your_time"]), hint]
        elif level == 1:
            out["say"] = [hint, say(PHRASES["ask_anytime"])]
        elif level is not None:
            out["say"] = [say(PHRASES["offer_help"])]
        if level is not None:
            out["coach"] = "stuck"
            s.flag("hinted")
    s.note_spoken([x["text"] for x in out["say"]])
    if status in ("mistake", "done", "in_progress", "confirming") and out["reason"]:
        s.last_seen = f"step {n}, {status.replace('_', ' ')}: {out['reason']}" + (f" Fix shown: {out['fix']}" if out.get("fix") else "")
    return out


async def _safe(coro) -> None:
    try:
        await coro
    except Exception as e:
        log.warning("background task failed: %s", e)


class CheckReq(BaseModel):
    image: str
    trigger: str = "pause"  # pause | left_area | voice | timeout | button


@router.post("/coach/{sid}/check")
async def coach_check(sid: str, req: CheckReq) -> dict:
    s = _sess(sid)
    if s.finished:
        return {"status": "finished", "finished": True, "say": [], "reason": "Task already finished", "source": "system", "latency_ms": 0, "confidence": 1, "escalated": False, "trigger": req.trigger}
    return await run_check(s, b64jpg(req.image), req.trigger)


class NextReq(BaseModel):
    reason: str = "button"


@router.post("/coach/{sid}/next")
async def coach_next(sid: str, req: NextReq) -> dict:
    s = _sess(sid)
    log_event(s, "skipped", "button", req.reason, 1.0, 0, "moved on by hand")
    return await _advance(s, "button", req.reason)


class LocateReq(BaseModel):
    image: str
    reason: str = ""


@router.post("/coach/{sid}/locate")
async def coach_locate(sid: str, req: LocateReq) -> dict:
    """Box the mistake in a snapshot (drawn on the live video). Runs after the correction is already spoken."""
    s = _sess(sid)
    try:
        r, ms = await run_model(claude.locate, M["claude"], "low", b64jpg(req.image), s.step, req.reason, timeout=15)
    except Exception as e:
        raise HTTPException(503, f"could not locate: {type(e).__name__}")
    return {"box": vision.parse_box(r.get("box")), "fix": r.get("fix", ""), "source": "claude", "latency_ms": round(ms)}


class GotoReq(BaseModel):
    index: int


@router.post("/coach/{sid}/goto")
async def coach_goto(sid: str, req: GotoReq) -> dict:
    """Worker moved by hand (Back/Next on the Steps page)."""
    s = _sess(sid)
    s.step_index = max(0, min(req.index, len(s.steps) - 1))
    s.unclear, s.finished, s.done_streak = 0, False, 0
    s.new_step()
    s.snapshots.clear()
    stdb().call("set_step", s.id, s.step_index)
    return await step_payload(s)


@router.get("/coach/{sid}/step")
async def coach_step(sid: str) -> dict:
    return await step_payload(_sess(sid))


class HelpReq(BaseModel):
    image: str | None = None


@router.post("/coach/{sid}/help")
async def coach_help(sid: str, req: HelpReq) -> dict:
    s = _sess(sid)
    photo = save_photo("help", s.id, b64jpg(req.image)) if req.image else ""
    stdb().call("request_help", s.id, s.worker_id, s.task["task_id"], s.step["id"], photo)
    log_event(s, "help", "button", "button", 1.0, 0, "help requested", photo)
    s.flag("help")
    for hook in HELP_SENT_HOOKS:
        try:
            hook(s.id)
        except Exception:
            log.exception("help hook failed")
    note_trouble(s, "help")  # Droid re-teach trigger (docs/DROID.md)
    return {"say": [say(PHRASES["help"])], "photo": photo}


# ---------- wristband: hold = call the supervisor (CALL), short touch = a quiet note ----------
WRIST_SAY = {"call": "Okay. I'm calling your supervisor now.", "notify": "Okay. I told your supervisor."}
WRIST_REDUCER = {"call": "call_supervisor", "notify": "notify_supervisor"}
WRIST_LOG = {"call": "wristband held: supervisor called", "notify": "wristband touched: supervisor notified"}
WRIST: dict = {"last_press": {"call": 0.0, "notify": 0.0}, "presses": 0, "last": None}


class WristPress(BaseModel):
    worker_id: str | None = None
    session_id: str | None = None
    kind: Literal["call", "notify"] = "call"


@router.post("/wrist/press")
async def wrist_press(req: WristPress | None = None) -> dict:
    """The wristband (or its on-screen stand-in) was pressed. kind=call (hold): ring the supervisor now, no buddy
    stage. kind=notify (short touch): a quiet note in the supervisor's help list, no ringing. Both carry the newest
    face-blurred live frame as the photo. Finds the worker's active session (or the most recent one); with none,
    still sends what we know."""
    req = req or WristPress()
    s = sessions.get(req.session_id or "")
    if not s and req.worker_id:
        s = next((x for x in reversed(list(sessions.values())) if x.worker_id == req.worker_id), None)
    if not s and not req.worker_id and not req.session_id and sessions:
        s = next(reversed(list(sessions.values())))
    if not s and req.session_id and req.session_id in ended:
        s = ended[req.session_id]
    worker = s.worker_id if s else (req.worker_id or "")
    if not worker:
        return {"ok": False, "say": [], "error": "no worker: send worker_id or session_id"}
    CURRENT_VOICE.set(task_voice(s.task) if s else voices.default_id())
    now = time.monotonic()
    again = now - WRIST["last_press"][req.kind] < 5  # a double tap must not send twice
    WRIST["last_press"][req.kind] = now
    out = {"ok": True, "kind": req.kind, "say": [say(WRIST_SAY[req.kind])], "worker_id": worker, "session_id": s.id if s else "", "duplicate": again}
    if again:
        return out
    WRIST["presses"] += 1
    WRIST["last"] = {"worker_id": worker, "kind": req.kind, "ts": time.time()}
    sid, tid, step = (s.id, s.task["task_id"], int(s.step["id"])) if s else (req.session_id or "", "", 0)
    photo = save_photo("wrist", s.id, s.snapshots[-1]) if s and s.snapshots else ""
    stdb().call(WRIST_REDUCER[req.kind], sid, worker, tid, step, photo)
    out["photo"] = photo
    if s:
        log_event(s, "help", "wristband", "wristband", 1.0, 0, WRIST_LOG[req.kind], photo)
        if req.kind == "call":
            s.flag("help")
            for hook in HELP_SENT_HOOKS:  # the wrist node shows CALL, whichever way the call came in
                try:
                    hook(s.id)
                except Exception:
                    log.exception("help hook failed")
            note_trouble(s, "help")  # Droid re-teach trigger (docs/DROID.md); a quiet note is not trouble
    return out


@router.get("/wrist/status")
def wrist_status() -> dict:
    """For the serial bridge: is the edge app up, who is active, and the last press."""
    return {
        "ok": True,
        "presses": WRIST["presses"],
        "last": WRIST["last"],
        "active": [{"session_id": x.id, "worker_id": x.worker_id} for x in sessions.values()],
    }


@router.post("/coach/{sid}/end")
async def coach_end(sid: str) -> dict:
    s = sessions.pop(sid, None)
    if s:
        ended[sid] = s
        while len(ended) > 50:
            ended.pop(next(iter(ended)))
    if s and not s.finished:
        stdb().call("end_session", s.id, "stopped")
    return {"ok": True}


@router.post("/coach/{sid}/talk")
async def coach_talk(sid: str, audio: UploadFile = File(...), image: str = Form("")) -> dict:
    s = _sess(sid)
    t0 = time.perf_counter()
    raw = await audio.read()
    try:
        said, stt_ms = await run_model(voice.transcribe, raw, audio.filename or "talk.webm", audio.content_type or "audio/webm", timeout=10)
    except Exception as e:
        raise HTTPException(503, f"speech-to-text unavailable: {type(e).__name__}")
    if not said or s.is_echo(said):
        # nothing, or the always-on mic heard the app's own voice
        return {"said": said, "intent": "echo" if said else "none", "answer": "", "say": [], "answered_by": "none", "latency_ms": round((time.perf_counter() - t0) * 1000)}
    intent = intent_of(said)
    st = s.step
    out: dict = {"said": said, "intent": intent, "stt_ms": round(stt_ms)}
    if intent == "check" and image:
        res = await run_check(s, b64jpg(image), "voice")
        out.update(check=res, answer=" ".join(x["text"] for x in res.get("say", [])) or "Keep going. You're doing it.", answered_by=res["source"])
        if res["status"] == "done":
            res["say"] = [say("Yes, that's right!")] + res.get("say", [])
        elif not res.get("say"):
            hint = res.get("hint") or ""
            res["say"] = [say("Not yet. Keep going.")] + ([say(hint)] if hint else [])
        out["say"] = res["say"]
        out["answer"] = " ".join(x["text"] for x in res["say"])
    elif intent == "help":
        h = await coach_help(sid, HelpReq(image=image or None))
        out.update(answer=PHRASES["help"], answered_by="instant", say=h["say"], help=True)
    elif intent == "stuck":
        # look first: a visible mistake gets its correction, otherwise the next small action
        if image:
            s.flag("hinted")
            res = await run_check(s, b64jpg(image), "stuck")
            out["check"] = res
            items = res.get("say") or [say(res.get("hint") or st["instruction"])]
        else:
            items = [say(st["instruction"])]
        items.append(say("If you still need help, say help."))
        out.update(answer=" ".join(x["text"] for x in items), answered_by="live", say=items)
    elif intent == "why":
        out.update(answer=st["why"], answered_by="instant", say=[say(st["why"])])
    elif intent == "repeat":
        out.update(answer=s.last_said or st["instruction"], answered_by="instant", say=[say(st["instruction"])])
    elif intent == "next":
        out.update(answer=st["instruction"], answered_by="instant", say=[say(st["instruction"])])
    else:
        frame = b64jpg(image) if image else None
        notes: list[str] = []
        try:  # Moss: what we remember about this worker, in-process
            mems, mem_ms = await memory.recall(s.worker_id, said)
            notes = [m["text"] for m in mems][:3]
            out["memory_ms"] = round(mem_ms, 2)
        except Exception as e:
            log.warning("answer: memory unavailable: %s", e)
        try:
            text, _ = await run_model(claude.answer, M["claude_answer"], M["claude_effort_answer"], said, frame, s.task["title"], st, s.step_index + 1, len(s.steps), notes, list(s.talk_log), s.last_seen, timeout=15)
        except Exception as e:
            text = "I'm not sure. Press help if you need a person."
            log.warning("claude answer failed: %s", e)
        if text.strip().strip(".").lower() in ("(silent)", "silent"):
            return {**out, "intent": "not_for_coach", "answer": "", "say": [], "answered_by": "none", "latency_ms": round((time.perf_counter() - t0) * 1000)}
        out.update(answer=text, answered_by="claude+moss" if notes else "claude", say=[say(text)])
    s.note_spoken([x["text"] for x in out.get("say", [])])
    if out.get("answer"):
        s.talk_log.append((said, out["answer"]))
    out["latency_ms"] = round((time.perf_counter() - t0) * 1000)
    stdb().call("log_talk", s.id, s.worker_id, said[:300], intent, out["answer"][:300], out["answered_by"], int(out["latency_ms"]))
    return out


# ---------- voice agent (Cartesia Managed Agent) ----------
# Cartesia runs the conversation; its client tools arrive on the worker screen's WebSocket, and the screen
# runs them here. Results are short plain text for the agent; "ui" tells the screen what changed.
@router.post("/coach/{sid}/agent")
async def coach_agent(sid: str) -> dict:
    s = _sess(sid)
    vid = task_voice(s.task)
    coach_name = ((s.task.get("voice") or {}).get("name") if vid else "") or "your coach"
    try:
        voice_id = vid or await asyncio.to_thread(voice.voice_id)
        agent_id = await asyncio.to_thread(agent.ensure, voice_id, coach_name)
        token = await asyncio.to_thread(agent.token)
    except Exception as e:
        log.warning("voice agent unavailable: %s", str(e)[:200])
        raise HTTPException(503, f"voice agent unavailable: {type(e).__name__}")
    return {
        "agent_id": agent_id,
        "url": AGENT_WS.format(agent_id=agent_id),
        "token": token,  # agent grant only, expires in minutes; the API key stays here
        "voice": {"id": voice_id, "name": coach_name, "cloned": bool(vid)},
    }


class AgentToolReq(BaseModel):
    tool: str
    parameters: dict = {}
    image: str = ""  # face-blurred frame, for check_my_work / call_a_helper


def _step_line(s: CoachSession) -> str:
    return f"Step {s.step_index + 1} of {len(s.steps)}: {s.step['instruction']}"


def _check_text(s: CoachSession, res: dict) -> str:
    st = res.get("status")
    if res.get("finished"):
        return "Done! That was the last step. The whole task is finished."
    if res.get("next"):
        return f"Done! The step is finished. Now {_step_line(s)}"
    if st == "mistake":
        return f"Almost. The camera sees: {res.get('reason') or 'something to fix'}. What to do: {res.get('fix') or s.step['correction']}"
    if st in ("in_progress", "confirming"):
        return "Not done yet." + (f" Next small action: {res['hint']}" if res.get("hint") else f" The step is: {s.step['instruction']}")
    if st in ("stale", "rate_limited"):
        return "The step just changed. Call what_is_my_step."
    return "The camera could not tell. Ask them to hold the work in front of the glasses and keep still, then check again."


@router.post("/coach/{sid}/agent/tool")
async def coach_agent_tool(sid: str, req: AgentToolReq) -> dict:
    s = _sess(sid)
    t0 = time.perf_counter()
    p = req.parameters or {}
    ui: dict = {}
    ok = True
    if s.finished and req.tool not in ("my_progress", "remember"):
        text = "The task is finished. Every step is done."
    elif req.tool == "what_is_my_step":
        fresh = await _levels(s)
        if fresh is not None:
            s.levels = fresh
        st, lvl = s.step, s.level_of()
        coach = ((s.task.get("voice") or {}).get("name") if task_voice(s.task) else "") or "their job coach"
        steps = " ".join(f"{k + 1}. {x['instruction']}" for k, x in enumerate(s.steps))
        text = f"Worker: {s.worker_name}. You speak as {coach}. Task: {s.task['title']}. All steps: {steps} Now: {_step_line(s)} Why: {st['why']} Done looks like: {st['done_right']} Common slip: {st['common_mistake']} Help level: {progress.LEVEL_NAMES[lvl]}."
        if lvl >= 2:
            text += " They know this step well: keep it very short."
        try:
            mems, _ = await memory.recall(s.worker_id, f"{st['instruction']}. {st['common_mistake']}")
            tip = next((m["tip"] for m in mems if m.get("kind") == "mistake" and m.get("tip")), "")
            if tip:
                text += f" Last time this helped: {tip}"
        except Exception as e:
            log.info("agent step: memory unavailable: %s", e)
    elif req.tool == "check_my_work":
        if not req.image:
            text, ok = "The camera is off. Ask them to turn it on.", False
        else:
            res = await run_check(s, b64jpg(req.image), "voice")
            text, ui = _check_text(s, res), {"check": res}
    elif req.tool == "call_a_helper":
        await coach_help(sid, HelpReq(image=req.image or None))
        text, ui = "Help alert sent to a coworker's phone, with a photo. If nobody answers in 20 seconds, the supervisor gets it.", {"help": True}
    elif req.tool == "my_progress":
        fresh = await _levels(s)
        if fresh is not None:
            s.levels = fresh
        lines = [f"Step {k + 1} ({st['instruction']}): {progress.LEVEL_NAMES[s.level_of(st)]}" for k, st in enumerate(s.steps)]
        done = len(s.steps) if s.finished else s.step_index
        text = f"Today: {done} of {len(s.steps)} steps done so far. Help needed per step, from the coach's records: " + "; ".join(lines) + "."
    elif req.tool == "change_step":
        if p.get("direction") == "back":
            if s.step_index == 0:
                text = f"They are already on step 1: {s.step['instruction']}"
            else:
                r = await coach_goto(sid, GotoReq(index=s.step_index - 1))
                text, ui = f"Moved back. Now {_step_line(s)}", {"goto": r["index"]}
        else:
            r = await coach_next(sid, NextReq(reason="voice"))
            text = "That was the last step. The task is finished." if r.get("finished") else f"Moved on. Now {_step_line(s)}"
            ui = {"check": {**r, "status": "skipped"}}
    elif req.tool == "remember":
        note = " ".join(str(p.get("note", "")).split())[:300]
        if note:
            asyncio.create_task(_safe(memory.add(s.worker_id, f"{s.worker_name} said: {note}", {"kind": "preference", "task": s.task["title"], "by": "voice agent"})))
        text = "Saved for the coach."
    else:
        text, ok = f"Unknown tool {req.tool}.", False
    return {"result": text, "ok": ok, "ui": ui, "latency_ms": round((time.perf_counter() - t0) * 1000)}


@router.get("/coach/{sid}/progress")
async def coach_progress(sid: str) -> dict:
    """Progress you can hear: SpacetimeDB's numbers for this session (vs. earlier tries) + one Moss detail,
    worded by Claude, spoken by Cartesia in the task's voice."""
    s = sessions.get(sid) or ended.get(sid)
    if not s:
        raise HTTPException(404, "session ended or unknown")
    CURRENT_VOICE.set(task_voice(s.task))
    t0 = time.perf_counter()
    db = stdb()
    await asyncio.to_thread(db.drain)  # this session's last events are still being written
    wid = s.worker_id.replace("'", "")
    try:
        rows_s = await asyncio.to_thread(db.sql, f"SELECT * FROM session WHERE worker_id = '{wid}'")
        rows_e = await asyncio.to_thread(db.sql, f"SELECT * FROM step_event WHERE worker_id = '{wid}'")
    except Exception as e:
        raise HTTPException(503, f"SpacetimeDB unavailable: {type(e).__name__}")
    titles = {r["task_id"]: (store.get(r["task_id"]) or {}).get("title", r["task_id"]) for r in rows_s}
    nums = progress.session_numbers(sid, rows_s, rows_e, titles, len(s.steps))
    try:  # fading: steps that moved toward independence in this session
        rows_o = await asyncio.to_thread(db.sql, f"SELECT step_id, level_before, level_after, reason FROM step_outcome WHERE session_id = '{sid.replace(chr(39), '')}'")
        step_text = {int(x["id"]): x["instruction"] for x in s.steps}
        if nums:
            nums["level_ups"] = [{"step": step_text.get(int(o["step_id"]), ""), "now": progress.LEVEL_NAMES[int(o["level_after"])]} for o in rows_o if o["reason"] == "promote"]
    except Exception as e:
        log.warning("progress: level history unavailable: %s", e)
    notes: list[str] = []
    try:
        mems, _ = await memory.recall(s.worker_id, f"{s.task['title']}: what was hard, mistakes, progress")
        notes = [m["text"] for m in mems][:3]
    except Exception as e:
        log.warning("progress: memory unavailable: %s", e)
    text = progress.template(s.worker_name, nums)
    words_by = "template"
    if nums:
        try:
            payload = {"worker": s.worker_name, "today": nums, "memory_notes": notes}
            out, _ = await run_model(claude._call, M["claude_answer"], "low", progress.PROGRESS_SYSTEM, [{"type": "text", "text": json.dumps(payload)}], None, 1500, timeout=10)
            if isinstance(out, str) and out.strip():
                text, words_by = " ".join(out.split()), "claude"
        except Exception as e:
            log.warning("progress: claude failed, using template: %s", e)
    if nums:  # remember it, so next time's summary can say what changed
        note = f"{s.worker_name} did {nums['task']}: {nums['by_self']} of {nums['total_steps']} steps without help, {nums['corrections']} corrections" + (f", {nums['minutes']} min" if nums.get("minutes") else "") + "."
        asyncio.create_task(_safe(memory.add(s.worker_id, note, {"kind": "progress", "task": nums["task"]})))
    return {"text": text, "say": [say(text)], "numbers": nums, "memory": notes, "worded_by": words_by, "latency_ms": round((time.perf_counter() - t0) * 1000)}


@router.get("/worker-id")
def worker_id(name: str) -> dict:
    """The id a worker's name maps to (same rule the coach uses), so a worker's screen can register for its own rows."""
    return {"worker_id": slug(name)}


# ---------- memory ----------
class NoteReq(BaseModel):
    text: str


@router.get("/memory/{worker}")
async def memory_list(worker: str) -> dict:
    return {"worker_id": slug(worker), "notes": await memory.all(slug(worker)), "error": memory.error}


@router.post("/memory/{worker}")
async def memory_add(worker: str, req: NoteReq) -> dict:
    if not req.text.strip():
        raise HTTPException(400, "empty note")
    await memory.add(slug(worker), req.text.strip(), {"kind": "note"})
    return {"ok": True}


@router.get("/memory/{worker}/recall")
async def memory_recall(worker: str, q: str) -> dict:
    mems, ms = await memory.recall(slug(worker), q)
    return {"memory": mems, "latency_ms": round(ms, 2)}


# ---------- worker report (supervisor) ----------
class ReportReq(BaseModel):
    worker_name: str
    sessions: list[dict]  # this worker's SpacetimeDB rows, sent by the supervisor page
    events: list[dict]
    help: list[dict] = []


@router.post("/report")
async def worker_report(req: ReportReq) -> dict:
    st = report.stats(req.sessions, req.events, req.help)
    notes = []
    try:
        notes = [n["text"] for n in await memory.all(slug(req.worker_name))][:15]
    except Exception as e:
        log.warning("report: memory unavailable: %s", e)
    words, ms = None, 0.0
    if st["sessions"]:
        payload = {"worker": req.worker_name, "measured": st, "coach_notes_from_memory": notes}
        try:
            words, ms = await run_model(
                claude._call, M["claude"], "medium", report.REPORT_SYSTEM,
                [{"type": "text", "text": json.dumps(payload, default=str)[:60000]}], report.REPORT_SCHEMA, 8000, timeout=90,
            )
        except Exception as e:
            log.warning("report: claude failed: %s", e)
    return {"worker": req.worker_name, "stats": st, "notes": notes, "report": words, "latency_ms": round(ms), "generated_at": time.time()}


def mount_files(app) -> None:
    from fastapi.staticfiles import StaticFiles

    DATA.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=str(DATA)), name="files")



# ---------- test set (PLAN.md: ~30 labeled snapshots) ----------
class LabelReq(BaseModel):
    image: str
    task_id: str
    step_id: int
    label: str  # done | mistake | in_progress


@router.post("/testset")
def testset_add(req: LabelReq) -> dict:
    if req.label not in ("done", "mistake", "in_progress"):
        raise HTTPException(400, "label must be done, mistake or in_progress")
    if not store.get(req.task_id):
        raise HTTPException(404, "no such task")
    import csv

    d = ROOT / "eval" / "test_set"
    d.mkdir(parents=True, exist_ok=True)
    name = f"{req.task_id}_s{req.step_id}_{req.label}_{int(time.time() * 1000)}.jpg"
    (d / name).write_bytes(b64jpg(req.image))
    labels = d / "labels.csv"
    new = not labels.exists()
    with labels.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["file", "task_id", "step_id", "label"])
        w.writerow([name, req.task_id, req.step_id, req.label])
    n = sum(1 for _ in labels.open()) - 1
    return {"saved": name, "count": n}


# ---------- supervisor video → tasks → steps ----------
from . import video as vid  # noqa: E402

DEMO_VIDEO = ROOT / "videos" / "supervisor.mp4"
DEMO_ID = "demo_supervisor"
MAX_UPLOAD = 300 * 1024 * 1024
jobs: dict[str, vid.Job] = {}


@router.get("/videos/demo")
def video_demo() -> dict:
    if not DEMO_VIDEO.exists():
        return {"available": False}
    return {"available": True, "url": "/videos/demo/file", "name": DEMO_VIDEO.name, **vid.probe(DEMO_VIDEO)}


@router.get("/videos/demo/file")
def video_demo_file():
    if not DEMO_VIDEO.exists():
        raise HTTPException(404, "no demo video")
    return FileResponse(DEMO_VIDEO, media_type="video/mp4")


async def run_video_job(job: vid.Job, path: Path, mime: str, delete_after: bool, consent_by: str = "") -> None:
    try:
        info = vid.probe(path)
        if info["duration"] <= 0:
            raise ValueError("video has no frames")
        if info["duration"] > 600:
            raise ValueError("please use a video under 10 minutes")
        job.to("transcribing")
        text, words, stt_ms = await asyncio.to_thread(vid_transcribe, path, mime)
        segs = vid.segments(words, text, info["duration"])
        voice_rec = None
        if consent_by:
            # The supervisor agreed: clone their voice from this video's narration (before the video is deleted).
            job.to("cloning_voice")
            try:
                wav, secs = await asyncio.to_thread(speech_clip, path, words or segs)
                vid_id = await asyncio.to_thread(voice.clone, wav, f"{consent_by} (IDD Help coach)", f"Cloned with consent from {consent_by}'s teach video {job.name}, only to coach workers on these tasks.")
                voice_rec = {"id": vid_id, "name": consent_by, "consent_by": consent_by, "consent_at": time.time(), "source_video": job.name, "clip_s": round(secs, 1)}
                voices.add(vid_id, voice_rec)
            except Exception as e:
                msg = str(e)
                job.voice_error = "Voice cloning needs a paid Cartesia plan, so the stock voice is used." if "402" in msg or "plan_upgrade" in msg else f"Voice clone failed ({type(e).__name__}): {msg[:120]}"
                log.warning("voice clone failed: %s", msg[:200])
        job.to("key_frames")
        frames, faces = await asyncio.to_thread(vid.key_frames, path)
        if not frames:
            raise ValueError("could not read frames from this video")
        urls = store.save_frames(f"video_{job.video_id}", [f for _, f in frames])  # shared frame folder for this video
        job.to("claude")
        out, claude_ms = await asyncio.to_thread(claude.video_tasks, M["claude"], M["claude_effort_teach"], frames, segs, info["duration"])
        job.to("saving")
        tasks = []
        for k, t in enumerate(out["tasks"]):
            task_id = task_id_for(t["title"])
            if any(x["task_id"] == task_id for x in tasks):
                task_id += f"_{k}"
            steps = []
            for i, s in enumerate(t["steps"]):
                ref = max(0, min(int(s.pop("reference_frame", 0)), len(urls) - 1))
                steps.append({"id": i + 1, **{k2: str(s.get(k2, "")) for k2 in ("instruction", "done_right", "common_mistake", "correction", "why", "praise", "cue")}, "reference_photo": urls[ref], "start_s": float(s["start_s"]), "end_s": float(s["end_s"]), "close_look": bool(s.get("close_look", True))})
            task = {"task_id": task_id, "title": t["title"], "summary": t.get("summary", ""), "steps": steps, "frames": urls, "saved": True, "source": {"kind": "video", "video_id": job.video_id, "name": job.name}, "voice": voice_rec}
            store.save(task)
            stdb().call("save_task", task_id, task["title"], json.dumps(steps))
            tasks.append(task)
        job.to("recording_voice")
        texts = [x for t in tasks for s in t["steps"] for x in (s["instruction"], s["correction"], s["why"], s.get("praise", ""), s.get("cue", "")) if x]
        if voice_rec:
            texts += list(PHRASES.values())  # praise, "Next step.", help… in the supervisor's voice too
        try:
            await asyncio.to_thread(voice.ensure_many, texts, voice_rec["id"] if voice_rec else None)
            audio_ok = True
        except Exception as e:
            log.warning("video pre-record failed: %s", e)
            audio_ok = False
        analysis = {
            "video_id": job.video_id,
            "name": job.name,
            "created_at": time.time(),
            "duration": round(info["duration"], 2),
            "video_url": "/videos/demo/file" if job.video_id == DEMO_ID else None,
            "transcript": segs,
            "transcript_clean": out.get("transcript_clean", ""),
            "frames": [{"t": t, "url": u} for (t, _), u in zip(frames, urls)],
            "faces_blurred": faces,
            "tasks": tasks,
            "audio_ok": audio_ok,
            "timings_ms": {"speech_to_text": round(stt_ms), "claude": round(claude_ms)},
            "raw_video_deleted": delete_after,
            "voice": voice_rec,
            "voice_error": getattr(job, "voice_error", None),
        }
        vid.save_analysis(DATA, job.video_id, analysis)
        job.to("done")
        job.result = analysis
    except Exception as e:
        log.exception("video job failed")
        job.error = f"{type(e).__name__}: {str(e)[:200]}"
        job.to("failed")
    finally:
        if delete_after:
            path.unlink(missing_ok=True)  # PLAN.md: no raw video stored


def vid_transcribe(path: Path, mime: str):
    from .voice import transcribe_words

    return transcribe_words(voice, path.read_bytes(), path.name, mime)


class AnalyzeReq(BaseModel):
    consent_by: str = ""  # non-empty = this person agreed to have their voice cloned from the video


@router.post("/videos/analyze-demo")
async def video_analyze_demo(req: AnalyzeReq | None = None) -> dict:
    if not DEMO_VIDEO.exists():
        raise HTTPException(404, "no demo video at videos/supervisor.mp4")
    job = vid.Job(DEMO_ID, DEMO_VIDEO.name)
    jobs[job.id] = job
    asyncio.create_task(run_video_job(job, DEMO_VIDEO, "video/mp4", delete_after=False, consent_by=(req.consent_by.strip() if req else "")))
    return job.view()


@router.post("/videos/upload")
async def video_upload(file: UploadFile = File(...), consent_by: str = Form("")) -> dict:
    name = Path(file.filename or "video.mp4").name
    ext = Path(name).suffix.lower()
    if ext not in (".mp4", ".mov", ".m4v", ".webm"):
        raise HTTPException(400, "please upload an .mp4, .mov, .m4v or .webm video")
    video_id = "up_" + uuid_hex()
    d = DATA / "videos" / video_id
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"source{ext}"
    size = 0
    with path.open("wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                f.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "video is over 300 MB")
            f.write(chunk)
    job = vid.Job(video_id, name)
    jobs[job.id] = job
    mime = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}[ext]
    asyncio.create_task(run_video_job(job, path, mime, delete_after=True, consent_by=consent_by.strip()))
    return job.view()


def uuid_hex() -> str:
    import uuid

    return uuid.uuid4().hex[:10]


@router.get("/videos/jobs/{job_id}")
def video_job(job_id: str) -> dict:
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "no such job")
    return j.view()


@router.get("/videos")
def video_list() -> list[dict]:
    return vid.list_analyses(DATA)


@router.get("/videos/{video_id}")
def video_get(video_id: str) -> dict:
    import re as _re

    if not _re.fullmatch(r"[a-z0-9_]+", video_id):
        raise HTTPException(400, "bad id")
    p = DATA / "videos" / video_id / "analysis.json"
    if not p.exists():
        raise HTTPException(404, "not analyzed yet")
    return json.loads(p.read_text())


# ---------- Droid re-teach engineer (docs/DROID.md) ----------
from . import droid as droid_mod  # noqa: E402

droid_jobs = droid_mod.Jobs(ROOT, DATA, store, stdb)
TROUBLE: dict[tuple[str, int], list[dict]] = {}  # (task_id, step_id) -> recent spoken corrections + help requests
TROUBLE_WINDOW_S = 3600


def _recent_trouble(task_id: str, step_id: int) -> list[dict]:
    key = (task_id, int(step_id))
    cut = time.time() - TROUBLE_WINDOW_S
    TROUBLE[key] = [t for t in TROUBLE.get(key, []) if t["ts"] >= cut]
    return TROUBLE[key]


def note_trouble(s: CoachSession, kind: str, reason: str = "", correction: str = "") -> None:
    """Record a spoken correction / help request; at 2 in an hour, ask Droid to re-teach the step (auto)."""
    try:
        tid, sid = s.task["task_id"], int(s.step["id"])
        log_ = _recent_trouble(tid, sid)
        log_.append({"ts": time.time(), "kind": kind, "reason": reason[:300], "correction": correction[:300], "worker": s.worker_name})
        n = len(log_)
        if n >= 2 and not droid_jobs.blocked(tid, sid, "auto"):
            asyncio.create_task(_safe(_droid_start(tid, sid, "auto", f"{n} corrections/help in the last hour", s.worker_id)))
    except Exception as e:  # never break the coach loop
        log.warning("droid trouble log: %s", e)


async def _droid_start(task_id: str, step_id: int, trigger: str, reason: str, worker_id: str | None = None) -> str | None:
    task = store.get(task_id)
    if not task:
        raise HTTPException(404, "no such task")
    st = next((x for x in task.get("steps", []) if int(x["id"]) == int(step_id)), None)
    if not st:
        raise HTTPException(404, "no such step")
    trouble = list(_recent_trouble(task_id, step_id))
    names = {t["worker"] for t in trouble if t.get("worker")}
    names |= {x.worker_name for x in list(sessions.values()) + list(ended.values()) if x.task["task_id"] == task_id and x.worker_name}
    wids = {worker_id} if worker_id else {x.worker_id for x in list(sessions.values()) + list(ended.values()) if x.task["task_id"] == task_id}
    notes: list[str] = []
    for w in list(wids)[:2]:
        try:
            mems, _ = await asyncio.wait_for(memory.recall(w, st["instruction"], top_k=3), 3)
            notes += [m["text"] for m in mems]
        except Exception as e:
            log.info("droid: moss recall failed: %s", e)
    return droid_jobs.start(task, step_id, trigger, reason, {"trouble": trouble, "notes": notes[:3], "names": sorted(names)})


class ReteachReq(BaseModel):
    task_id: str
    step_id: int
    trigger: str = "supervisor"
    reason: str = ""


@router.post("/droid/reteach")
async def droid_reteach(req: ReteachReq) -> dict:
    trig = req.trigger if req.trigger in ("supervisor", "auto") else "supervisor"
    jid = await _droid_start(req.task_id, req.step_id, trig, req.reason.strip() or "Supervisor asked Droid to fix this step")
    if not jid:
        raise HTTPException(409, "a Droid job for this step is already active")
    return {"job_id": jid}


@router.get("/droid/jobs")
def droid_list() -> list[dict]:
    return droid_jobs.list()


@router.post("/droid/jobs/{job_id}/approve")
async def droid_approve(job_id: str) -> dict:
    try:
        task = droid_jobs.approve(job_id)
    except KeyError:
        raise HTTPException(404, "no such job")
    except ValueError as e:
        raise HTTPException(409, str(e))
    try:
        await asyncio.to_thread(voice.ensure_many, droid_mod.Jobs.texts(task["steps"]), task_voice(task))
        audio_ok = True
    except Exception as e:
        log.warning("droid approve: pre-record failed: %s", e)
        audio_ok = False
    return {"job": droid_jobs.get(job_id), "task": task, "audio_ok": audio_ok}


@router.post("/droid/jobs/{job_id}/reject")
def droid_reject(job_id: str) -> dict:
    try:
        return droid_jobs.reject(job_id)
    except KeyError:
        raise HTTPException(404, "no such job")
    except ValueError as e:
        raise HTTPException(409, str(e))
