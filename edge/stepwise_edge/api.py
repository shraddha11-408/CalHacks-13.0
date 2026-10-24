"""MVP HTTP API (PLAN.md): teach, coach, talk, help, memory.

Every model call runs off the event loop with a timeout. The database is
written fire-and-forget. If a model is slow or down, the worker can still say
"done" or press Next, so the demo never freezes.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
import base64
import json
import logging
import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import claude, vision
from .coach import CoachSession, intent_of, spoken_tip
from .config import ROOT, load_config
from .memory import Memory, slug
from .stdb import Stdb
from .tasks import TaskStore, task_id_for
from .voice import PHRASES, Voice

log = logging.getLogger("stepwise.api")
CFG = load_config()
COACH = CFG["coach"]
M = CFG["models"]
DATA = ROOT / "data"

router = APIRouter()
store = TaskStore(DATA)
voice = Voice(DATA / "audio")
memory = Memory(DATA / "moss")
sessions: dict[str, CoachSession] = {}
_stdb: Stdb | None = None


def stdb() -> Stdb:
    global _stdb
    if _stdb is None:
        _stdb = Stdb(CFG)
    return _stdb


def b64jpg(s: str) -> bytes:
    if "," in s[:64]:
        s = s.split(",", 1)[1]
    data = base64.b64decode(s)
    if not data.startswith(b"\xff\xd8"):
        raise HTTPException(400, "expected a JPEG image")
    return data


def say(text: str, cached_only: bool = False) -> dict:
    """A phrase to speak: cached clip URL if present, else an on-demand TTS URL."""
    p = voice.path(text)
    if p.exists():
        return {"text": text, "url": voice.url(text)}
    from urllib.parse import quote

    return {"text": text, "url": None if cached_only else f"/tts?text={quote(text)}"}


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
def public_config() -> dict:
    return {"coach": COACH, "spacetimedb": stdb().public(), "phrases": {k: say(v) for k, v in PHRASES.items()}}


async def startup() -> None:
    """Called from the app lifespan. Pre-records fixed phrases; never blocks startup on the network."""
    async def go():
        try:
            await asyncio.to_thread(voice.ensure_many, list(PHRASES.values()))
        except Exception as e:
            voice.error = f"{type(e).__name__}: {str(e)[:120]}"
            log.warning("phrase pre-record failed: %s", e)

    asyncio.create_task(go())
    asyncio.create_task(asyncio.to_thread(stdb))


@router.get("/tts")
async def tts(text: str):
    if not text.strip() or len(text) > 400:
        raise HTTPException(400, "text must be 1–400 characters")
    try:
        await asyncio.to_thread(voice.ensure, text)
    except Exception as e:
        raise HTTPException(503, f"voice unavailable: {type(e).__name__}")
    return FileResponse(voice.path(text), media_type="audio/mpeg")


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
    keep = ("instruction", "done_right", "common_mistake", "correction", "why", "reference_photo")
    steps = []
    for s in req.steps:
        if not str(s.get("instruction", "")).strip():
            continue
        row = {"id": len(steps) + 1, **{k: str(s.get(k, "")) for k in keep}}
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
    texts = [t for s in steps for t in (s["instruction"], s["correction"], s["why"])]
    t0 = time.perf_counter()
    try:
        await asyncio.to_thread(voice.ensure_many, texts)
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


async def step_payload(s: CoachSession) -> dict:
    st = s.step
    mems, ms = await memory.recall(s.worker_id, f"{st['instruction']}. {st['common_mistake']}")
    speak = []
    tip = next((m for m in mems if m.get("kind") == "mistake" and m.get("tip")), None)
    if tip:
        phrase = spoken_tip(tip["tip"])
        if phrase:
            speak.append(say(phrase))
    speak.append(say(st["instruction"]))
    s.last_said = " ".join(x["text"] for x in speak)
    return {
        "session_id": s.id,
        "index": s.step_index,
        "total": len(s.steps),
        "step": st,
        "say": speak,
        "memory": mems,
        "memory_ms": round(ms, 2),
        "finished": s.finished,
    }


@router.post("/coach/start")
async def coach_start(req: StartReq) -> dict:
    task = store.get(req.task_id)
    if not task or not task.get("steps"):
        raise HTTPException(404, "no such task (teach and save it first)")
    wid = slug(req.worker_name)
    s = CoachSession(worker_id=wid, worker_name=req.worker_name.strip() or "Worker", task=task)
    sessions[s.id] = s
    stdb().call("upsert_worker", wid, s.worker_name)
    stdb().call("start_session", s.id, wid, task["task_id"])
    return {**await step_payload(s), "task": {"task_id": task["task_id"], "title": task["title"]}, "worker_id": wid}


def _sess(sid: str) -> CoachSession:
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404, "session ended or unknown")
    return s


def log_event(s: CoachSession, kind: str, source: str, trigger: str, conf: float, ms: float, note: str, photo: str = "") -> None:
    stdb().call("log_step_event", s.id, s.worker_id, s.task["task_id"], s.step["id"], kind, source, trigger, float(conf), int(ms), note[:200], photo)


async def _advance(s: CoachSession, source: str, trigger: str) -> dict:
    done_step = s.step
    finished = s.advance()
    stdb().call("set_step", s.id, s.step_index)
    if finished:
        stdb().call("end_session", s.id, "done")
        return {"finished": True, "say": [say(PHRASES["great"]), say(PHRASES["all_done"])], "completed_step": done_step["id"]}
    nxt = await step_payload(s)
    nxt["say"] = [say(PHRASES["great"])] + nxt["say"]
    return {"finished": False, "next": nxt, "say": nxt["say"], "completed_step": done_step["id"]}


async def run_check(s: CoachSession, jpg: bytes, trigger: str) -> dict:
    s.snapshots.append(jpg)
    st = s.step
    ref = store.frame(s.task["task_id"], st.get("reference_photo", "")) if st.get("reference_photo") else None
    source = "bitdeer"
    t0 = time.perf_counter()
    try:
        result, ms = await run_model(vision.check, M["bitdeer_base_url"], M["bitdeer_vision"], jpg, ref, st, s.task)
    except Exception as e:
        log.warning("bitdeer check failed: %s", e)
        result, ms, source = {"status": "unclear", "confidence": 0.0, "reason": f"Bitdeer unavailable ({type(e).__name__})"}, (time.perf_counter() - t0) * 1000, "bitdeer"
        s.unclear = max(s.unclear, COACH["unclear_escalate"] - 1)  # go straight to Claude
    status = s.classify(result, COACH["low_confidence"], COACH["done_confidence"])
    escalated = False
    if status == "unclear" and s.note_unclear(COACH["unclear_escalate"]):
        escalated, source = True, "claude"
        try:
            result, ms2 = await run_model(claude.judge, M["claude"], M["claude_effort_judge"], list(s.snapshots), ref, st, timeout=COACH["check_timeout_s"] * 2)
            ms += ms2
            status = s.classify(result, COACH["low_confidence"], COACH["done_confidence"])
        except Exception as e:
            log.warning("claude judge failed: %s", e)
            result = {"status": "unclear", "confidence": 0.0, "reason": f"Models unavailable ({type(e).__name__})"}
            status = "unavailable"
        s.unclear = 0
    # Debounce "done" (AGENTS.md §6): advance only on the 2nd consecutive done, >= 1 s apart.
    if status == "done":
        if not s.note_done(time.monotonic(), COACH["done_confirm"], COACH["done_min_gap_s"]):
            status = "confirming"
    else:
        s.not_done()
    photo = save_photo("check", s.id, jpg) if status == "mistake" else ""
    log_event(s, {"unavailable": "unclear", "confirming": "in_progress"}.get(status, status), source, trigger, result.get("confidence", 0), ms, result.get("reason", ""), photo)
    box = vision.parse_box(result.get("box")) if status == "mistake" else None
    out: dict = {"status": status, "confidence": result.get("confidence", 0), "reason": result.get("reason", ""), "source": source, "latency_ms": round(ms), "escalated": escalated, "trigger": trigger, "say": [], "box": box, "fix": (result.get("fix") or st["correction"]) if status == "mistake" else ""}
    if status == "done":
        out.update(await _advance(s, source, trigger))
    elif status == "mistake":
        out["say"] = [say(st["correction"])]
        meta = {"kind": "mistake", "task_id": s.task["task_id"], "task": s.task["title"], "step_id": st["id"], "tip": st["correction"]}
        text = f"{s.worker_name} had trouble with \"{st['instruction']}\" while doing {s.task['title']}: {result.get('reason') or st['common_mistake']}"
        asyncio.create_task(_safe(memory.add(s.worker_id, text, meta)))
    elif status == "unavailable" and trigger in ("voice", "button"):
        # demo never freezes: an explicit "done" moves on when the models can't answer
        out.update(await _advance(s, "system", trigger))
        out["status"] = "skipped"
    elif escalated and status == "unclear":
        out["say"] = [say(PHRASES["not_sure"])]
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
    return {"say": [say(PHRASES["help"])], "photo": photo}


@router.post("/coach/{sid}/end")
async def coach_end(sid: str) -> dict:
    s = sessions.pop(sid, None)
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
    if not said:
        return {"said": "", "intent": "none", "answer": "", "say": [], "answered_by": "none", "latency_ms": round((time.perf_counter() - t0) * 1000)}
    intent = intent_of(said)
    st = s.step
    out: dict = {"said": said, "intent": intent, "stt_ms": round(stt_ms)}
    if intent == "check" and image:
        res = await run_check(s, b64jpg(image), "voice")
        out.update(check=res, answer=" ".join(x["text"] for x in res.get("say", [])) or "Keep going. You're doing it.", answered_by=res["source"])
        out["say"] = res.get("say") or [say("Keep going. You're doing it.")]
    elif intent == "help":
        h = await coach_help(sid, HelpReq(image=image or None))
        out.update(answer=PHRASES["help"], answered_by="instant", say=h["say"], help=True)
    elif intent == "why":
        out.update(answer=st["why"], answered_by="instant", say=[say(st["why"])])
    elif intent == "repeat":
        out.update(answer=s.last_said or st["instruction"], answered_by="instant", say=[say(st["instruction"])])
    elif intent == "next":
        out.update(answer=st["instruction"], answered_by="instant", say=[say(st["instruction"])])
    else:
        frame = b64jpg(image) if image else None
        try:
            text, _ = await run_model(claude.answer, M["claude"], M["claude_effort_answer"], said, frame, s.task["title"], st, s.step_index + 1, len(s.steps), timeout=15)
        except Exception as e:
            text = "I'm not sure. Press help if you need a person."
            log.warning("claude answer failed: %s", e)
        out.update(answer=text, answered_by="claude", say=[say(text)])
    out["latency_ms"] = round((time.perf_counter() - t0) * 1000)
    stdb().call("log_talk", s.id, s.worker_id, said[:300], intent, out["answer"][:300], out["answered_by"], int(out["latency_ms"]))
    return out


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


async def run_video_job(job: vid.Job, path: Path, mime: str, delete_after: bool) -> None:
    try:
        info = vid.probe(path)
        if info["duration"] <= 0:
            raise ValueError("video has no frames")
        if info["duration"] > 600:
            raise ValueError("please use a video under 10 minutes")
        job.to("transcribing")
        text, words, stt_ms = await asyncio.to_thread(vid_transcribe, path, mime)
        segs = vid.segments(words, text, info["duration"])
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
                steps.append({"id": i + 1, **{k2: str(s[k2]) for k2 in ("instruction", "done_right", "common_mistake", "correction", "why")}, "reference_photo": urls[ref], "start_s": float(s["start_s"]), "end_s": float(s["end_s"])})
            task = {"task_id": task_id, "title": t["title"], "summary": t.get("summary", ""), "steps": steps, "frames": urls, "saved": True, "source": {"kind": "video", "video_id": job.video_id, "name": job.name}}
            store.save(task)
            stdb().call("save_task", task_id, task["title"], json.dumps(steps))
            tasks.append(task)
        job.to("recording_voice")
        texts = [x for t in tasks for s in t["steps"] for x in (s["instruction"], s["correction"], s["why"])]
        try:
            await asyncio.to_thread(voice.ensure_many, texts)
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


@router.post("/videos/analyze-demo")
async def video_analyze_demo() -> dict:
    if not DEMO_VIDEO.exists():
        raise HTTPException(404, "no demo video at videos/supervisor.mp4")
    job = vid.Job(DEMO_ID, DEMO_VIDEO.name)
    jobs[job.id] = job
    asyncio.create_task(run_video_job(job, DEMO_VIDEO, "video/mp4", delete_after=False))
    return job.view()


@router.post("/videos/upload")
async def video_upload(file: UploadFile = File(...)) -> dict:
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
    asyncio.create_task(run_video_job(job, path, mime, delete_after=True))
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
