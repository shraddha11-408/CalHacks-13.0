"""Moss personal memory (PLAN.md §5): plain-language notes about each worker.

One Moss session index per worker ("memory_<worker_id>"). Notes are embedded and
queried locally (no cloud round trip); push_index syncs to Moss Cloud in the
background, and save_to_disk keeps memory across restarts with no network.
Moss down → no memories, never a crash: the coach keeps the plain instruction.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path

from moss import DocumentInfo, MossClient, QueryOptions

log = logging.getLogger("stepwise.memory")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "worker"


class Memory:
    def __init__(self, cache_dir: Path) -> None:
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self._client: MossClient | None = None
        self._sessions: dict[str, object] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self.error: str | None = None

    def _c(self) -> MossClient:
        if self._client is None:
            self._client = MossClient(os.getenv("MOSS_PROJECT_ID", ""), os.getenv("MOSS_PROJECT_KEY", ""), cache_path=str(self.dir))
        return self._client

    async def _session(self, worker_id: str):
        name = f"memory_{slug(worker_id)}"
        lock = self._locks.setdefault(name, asyncio.Lock())
        async with lock:
            if name not in self._sessions:
                disk = self.dir / "sessions_local" / name
                try:
                    if disk.exists():  # saved on this laptop: no network needed
                        s = await self._c().session(name, "moss-minilm", auto_load_on_init=False)
                        await s.load_from_disk(str(disk))
                    else:
                        try:  # first time here: pull any cloud copy (one network call)
                            s = await self._c().session(name, "moss-minilm")
                        except Exception as e:  # offline: start empty
                            log.warning("moss cloud load failed for %s: %s", name, e)
                            s = await self._c().session(name, "moss-minilm", auto_load_on_init=False)
                    self._sessions[name] = s
                    self.error = None
                except Exception as e:
                    self.error = f"{type(e).__name__}: {str(e)[:120]}"
                    raise
            return self._sessions[name], name

    async def add(self, worker_id: str, text: str, meta: dict[str, str]) -> None:
        s, name = await self._session(worker_id)
        doc = DocumentInfo(id=f"note_{int(time.time() * 1000)}", text=text, metadata={k: str(v) for k, v in meta.items()})
        await s.add_docs([doc])
        disk = self.dir / "sessions_local" / name
        disk.mkdir(parents=True, exist_ok=True)
        await s.save_to_disk(str(disk))
        asyncio.create_task(self._push(s, name))

    async def _push(self, s, name: str) -> None:
        try:
            await s.push_index()
        except Exception as e:  # cloud sync is best-effort
            log.warning("moss push failed for %s: %s", name, e)

    async def recall(self, worker_id: str, query: str, top_k: int = 3, min_score: float = 0.35) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        try:
            s, _ = await self._session(worker_id)
            if s.doc_count == 0:
                return [], (time.perf_counter() - t0) * 1000
            res = await s.query(query, QueryOptions(top_k=top_k))
        except Exception as e:
            self.error = f"{type(e).__name__}: {str(e)[:120]}"
            return [], (time.perf_counter() - t0) * 1000
        ms = (time.perf_counter() - t0) * 1000
        out = [{"id": d.id, "text": d.text, "score": round(d.score, 3), **(d.metadata or {})} for d in res.docs if d.score >= min_score]
        return out, ms

    async def all(self, worker_id: str) -> list[dict]:
        try:
            s, _ = await self._session(worker_id)
            docs = await s.get_docs()
        except Exception as e:
            self.error = f"{type(e).__name__}: {str(e)[:120]}"
            return []
        return sorted(({"id": d.id, "text": d.text, **(d.metadata or {})} for d in docs), key=lambda d: d["id"], reverse=True)
