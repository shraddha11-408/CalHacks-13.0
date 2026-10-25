"""Droid re-teach engineer, edge side (docs/DROID.md).

Builds a per-job sandbox folder, spawns `node droid/reteach.mjs <sandbox>`, streams its NDJSON events to
SpacetimeDB (droid_job_set / droid_event_log) and a local job record (data/droid/<job_id>.json). A supervisor
approves a proposal before anything goes live. Never on the coach hot path: runs as a background task.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("stepwise.droid")

ACTIVE = ("queued", "running", "proposed")
AUTO_COOLDOWN_S = 3600
TIMEOUT_S = 200
STEP_FIELDS = ("instruction", "cue", "done_right", "common_mistake", "correction", "why", "praise", "close_look")


def scrub(text: str, names: list[str]) -> str:
    for n in sorted({n.strip() for n in names if n and n.strip()}, key=len, reverse=True):
        text = re.sub(rf"\b{re.escape(n)}\b", "the worker", text, flags=re.IGNORECASE)
    return text


def build_evidence(task: dict, step: dict, idx: int, reason: str, evidence: dict) -> str:
    names = [n for n in evidence.get("names", []) if n]
    lines = [f"# Evidence for re-teaching step {idx} of {len(task.get('steps', []))}: {task.get('title', '')}", "",
             f"Target step number: {idx} (id {step.get('id')})", "", "## Current step"]
    for k in STEP_FIELDS:
        if k in step:
            lines.append(f"- {k}: {step[k]}")
    lines += ["", "## Why Droid was asked", scrub(reason or "(no reason given)", names), "",
              "## What went wrong (newest first)"]
    trouble = sorted(evidence.get("trouble", []), key=lambda t: t.get("ts", 0), reverse=True)
    corr = [t for t in trouble if t.get("kind") == "correction"]
    for t in corr:
        lines.append(f"- reason: {scrub(t.get('reason') or '', names)} | correction spoken: {scrub(t.get('correction') or '', names)}")
    if not corr:
        lines.append("- (no spoken corrections recorded)")
    lines += ["", f"Help requests on this step: {sum(1 for t in trouble if t.get('kind') == 'help')}", "",
              "## Notes about the worker (Moss memory)"]
    notes = evidence.get("notes", [])
    lines += [f"- {scrub(n, names)}" for n in notes] or ["- (none)"]
    lines += ["", "Names: " + (", ".join(sorted(set(names))) or "(none)"),
              "(Never write any of these names in proposed.json.)", ""]
    return "\n".join(lines)


class Jobs:
    def __init__(self, repo: Path, data_dir: Path, store, stdb: Callable[[], Any],
                 ensure_voice: Callable[[list[str], dict], Any] | None = None) -> None:
        self.repo = Path(repo)
        self.dir = Path(data_dir) / "droid"
        self.store = store
        self.stdb = stdb
        self.ensure_voice = ensure_voice
        self.jobs: dict[str, dict] = {}
        self.tasks: set[asyncio.Task] = set()
        self.dir.mkdir(parents=True, exist_ok=True)
        for p in self.dir.glob("dj_*.json"):
            try:
                j = json.loads(p.read_text())
                if j.get("status") in ("queued", "running"):
                    j["status"], j["error"] = "failed", "edge restarted while running"
                self.jobs[j["id"]] = j
            except Exception as e:  # a corrupt record must not stop the app
                log.warning("droid: skip %s: %s", p.name, e)

    # ---------- records ----------
    def _save(self, j: dict) -> None:
        j["updated_at"] = time.time()
        (self.dir / f"{j['id']}.json").write_text(json.dumps(j, indent=2))

    def _push(self, j: dict) -> None:
        self._save(j)
        prop = json.dumps({"steps": j.get("steps") or [], "why": j.get("why") or ""}) if j.get("steps") else ""
        self.stdb().call("droid_job_set", j["id"], j["task_id"], int(j["step_id"]), j["trigger"], j["reason"],
                         j["status"], j.get("plan") or "", j.get("summary") or "", prop)

    def _event(self, j: dict, kind: str, text: str) -> None:
        j["events"].append({"kind": kind, "text": text[:2000], "ts": time.time()})
        j["events"] = j["events"][-200:]
        self.stdb().call("droid_event_log", j["id"], kind, text[:500])

    def list(self) -> list[dict]:
        return sorted(self.jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)

    def get(self, job_id: str) -> dict | None:
        return self.jobs.get(job_id)

    def blocked(self, task_id: str, step_id: int, trigger: str) -> str | None:
        now = time.time()
        for j in self.jobs.values():
            if j["task_id"] != task_id or int(j["step_id"]) != int(step_id):
                continue
            if j["status"] in ACTIVE:
                return f"job {j['id']} is {j['status']}"
            if trigger == "auto" and now - j.get("created_at", 0) < AUTO_COOLDOWN_S:
                return f"job {j['id']} ran in the last hour"
        return None

    # ---------- start ----------
    def start(self, task: dict, step_id: int, trigger: str = "supervisor", reason: str = "",
              evidence: dict | None = None, spawn: bool = True) -> str | None:
        """Create a job and (by default) run it in the background. None if refused (active / cooldown)."""
        evidence = evidence or {}
        steps = task.get("steps", [])
        idx = next((i for i, s in enumerate(steps, 1) if int(s["id"]) == int(step_id)), None)
        if idx is None:
            raise ValueError(f"no step {step_id} in {task.get('task_id')}")
        why = self.blocked(task["task_id"], step_id, trigger)
        if why:
            log.info("droid: refused %s/%s: %s", task["task_id"], step_id, why)
            return None
        job_id = "dj_" + secrets.token_hex(5)
        now = time.time()
        j = {"id": job_id, "task_id": task["task_id"], "title": task.get("title", ""), "step_id": int(step_id),
             "step_index": idx, "trigger": trigger, "reason": scrub(reason, evidence.get("names", [])),
             "status": "queued", "plan": "", "summary": "", "steps": None, "why": "", "error": "",
             "before": steps[idx - 1], "events": [], "created_at": now, "updated_at": now}
        self.jobs[job_id] = j
        sb = self.sandbox(j, task, evidence)
        j["sandbox"] = str(sb.relative_to(self.repo)) if sb.is_relative_to(self.repo) else str(sb)
        self._push(j)
        if spawn:
            t = asyncio.get_running_loop().create_task(self._run(j, sb))
            self.tasks.add(t)
            t.add_done_callback(self.tasks.discard)
        return job_id

    def sandbox(self, j: dict, task: dict, evidence: dict) -> Path:
        sb = self.repo / "droid" / "sandboxes" / j["id"]
        sb.mkdir(parents=True, exist_ok=True)
        tpl = self.repo / "droid" / "reteach-template"
        for name in ("AGENTS.md", "validate.py"):
            src = tpl / name
            if src.is_file():
                shutil.copy2(src, sb / name)
            else:
                log.warning("droid: template file missing: %s", src)
        (sb / "task.json").write_text(json.dumps(task, indent=2))
        (sb / "evidence.md").write_text(build_evidence(task, j["before"], j["step_index"], j["reason"], evidence))
        return sb

    async def _run(self, j: dict, sb: Path) -> None:
        runner = self.repo / "droid" / "reteach.mjs"
        j["status"] = "running"
        self._push(j)
        final: dict | None = None
        proc = None
        try:
            if not runner.is_file():
                raise FileNotFoundError(f"{runner.relative_to(self.repo)} not found")
            proc = await asyncio.create_subprocess_exec(
                "node", str(runner), str(sb), cwd=str(self.repo / "droid"),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

            async def read() -> dict | None:
                assert proc and proc.stdout
                async for raw in proc.stdout:
                    line = raw.decode(errors="replace").strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        self._event(j, "log", line)
                        continue
                    kind = str(ev.get("kind") or "text")
                    if kind == "final":
                        return ev
                    text = str(ev.get("text") or "")
                    if kind == "plan" and not j["plan"]:
                        j["plan"] = text[:2000]
                    self._event(j, kind, text)
                    self._save(j)
                return None

            final = await asyncio.wait_for(read(), TIMEOUT_S)
        except asyncio.TimeoutError:
            j["error"] = f"timed out after {TIMEOUT_S} s"
        except Exception as e:
            j["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        finally:
            if proc and proc.returncode is None:
                try:
                    await asyncio.wait_for(proc.wait(), 5)
                except asyncio.TimeoutError:
                    proc.kill()
        if final is not None:
            j["summary"] = str(final.get("summary") or "")
            j["why"] = str(final.get("why") or "")
            j["error"] = str(final.get("error") or "")
            ok = bool(final.get("ok")) and isinstance(final.get("steps"), list) and 1 <= len(final["steps"]) <= 2
            j["steps"] = final.get("steps") if ok else None
            j["status"] = "proposed" if ok else "failed"
            self._event(j, "final", j["summary"] or j["error"] or j["status"])
        else:
            j["status"] = "failed"
            j["error"] = j["error"] or "runner ended without a final event"
            self._event(j, "error", j["error"])
        self._push(j)

    # ---------- supervisor decision ----------
    def approve(self, job_id: str) -> dict:
        j = self.jobs.get(job_id)
        if not j:
            raise KeyError(job_id)
        if j["status"] != "proposed" or not j.get("steps"):
            raise ValueError(f"job is {j['status']}, not proposed")
        task = self.store.get(j["task_id"])
        if not task:
            raise ValueError(f"task {j['task_id']} no longer exists")
        steps = task["steps"]
        idx = next((i for i, s in enumerate(steps) if int(s["id"]) == int(j["step_id"])), None)
        if idx is None:
            raise ValueError(f"step {j['step_id']} no longer in the task")
        old = steps[idx]
        new = []
        for k, p in enumerate(j["steps"]):
            st = {f: p[f] for f in STEP_FIELDS if f in p}
            st["close_look"] = bool(st.get("close_look", False))
            if k == 0:
                for f in ("reference_photo", "start_s", "end_s"):
                    if f in old:
                        st[f] = old[f]
            st["droid_job"] = job_id
            new.append(st)
        steps = steps[:idx] + new + steps[idx + 1:]
        for n, st in enumerate(steps, 1):
            st["id"] = n
        task["steps"] = steps
        self.store.save(task)
        self.stdb().call("save_task", task["task_id"], task["title"], json.dumps(steps))
        j["status"] = "approved"
        j["approved_at"] = time.time()
        self._event(j, "status", "approved by supervisor")
        self._push(j)
        return task

    def reject(self, job_id: str) -> dict:
        j = self.jobs.get(job_id)
        if not j:
            raise KeyError(job_id)
        if j["status"] in ("approved",):
            raise ValueError("already approved")
        j["status"] = "rejected"
        self._event(j, "status", "rejected by supervisor")
        self._push(j)
        return j

    @staticmethod
    def texts(steps: list[dict]) -> list[str]:
        return [t for s in steps for t in (s.get("instruction"), s.get("correction"), s.get("why"), s.get("praise"), s.get("cue")) if t]
