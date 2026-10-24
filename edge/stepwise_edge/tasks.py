"""Task store on the edge laptop: data/tasks/<task_id>/{task.json, frames/*.jpg}.

Photos stay on this laptop (PLAN.md privacy rule); SpacetimeDB rows reference
them by URL path (/files/...). Key frames arrive already face-blurred from the browser.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path


def task_id_for(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")[:40] or "task"
    return f"{base}_{int(time.time())}"


class TaskStore:
    def __init__(self, root: Path) -> None:
        self.root = root / "tasks"
        self.root.mkdir(parents=True, exist_ok=True)

    def dir(self, task_id: str) -> Path:
        if not re.fullmatch(r"[a-z0-9_]+", task_id):
            raise ValueError("bad task id")
        return self.root / task_id

    def save_frames(self, task_id: str, frames: list[bytes]) -> list[str]:
        d = self.dir(task_id) / "frames"
        d.mkdir(parents=True, exist_ok=True)
        urls = []
        for i, jpg in enumerate(frames):
            (d / f"kf_{i:02d}.jpg").write_bytes(jpg)
            urls.append(f"/files/tasks/{task_id}/frames/kf_{i:02d}.jpg")
        return urls

    def frame(self, task_id: str, ref: str) -> bytes | None:
        """ref is a /files/tasks/<id>/frames/kf_XX.jpg URL or a bare file name."""
        m = re.fullmatch(r"/files/tasks/([a-z0-9_]+)/frames/(kf_\d+\.jpg)", ref)
        p = (self.dir(m.group(1)) / "frames" / m.group(2)) if m else (self.dir(task_id) / "frames" / ref.rsplit("/", 1)[-1])
        return p.read_bytes() if p.is_file() else None

    def save(self, task: dict) -> dict:
        d = self.dir(task["task_id"])
        d.mkdir(parents=True, exist_ok=True)
        task["updated_at"] = time.time()
        (d / "task.json").write_text(json.dumps(task, indent=2))
        return task

    def get(self, task_id: str) -> dict | None:
        p = self.dir(task_id) / "task.json"
        return json.loads(p.read_text()) if p.exists() else None

    def list(self) -> list[dict]:
        out = []
        for p in sorted(self.root.glob("*/task.json")):
            t = json.loads(p.read_text())
            out.append({"task_id": t["task_id"], "title": t["title"], "steps": len(t.get("steps", [])), "updated_at": t.get("updated_at", 0)})
        return sorted(out, key=lambda t: t["updated_at"], reverse=True)
