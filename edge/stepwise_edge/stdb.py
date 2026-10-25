"""SpacetimeDB over HTTP (PLAN.md: SpacetimeDB replaces Convex).

Writes are fire-and-forget on a small thread pool: the coach loop never waits
on the database. The edge keeps ONE identity across restarts (token saved in
data/, git-ignored, never logged), registers as the trusted `edge` device, and
sends a heartbeat so the floor knows it is alive.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from concurrent.futures import Future, ThreadPoolExecutor, wait

import httpx

log = logging.getLogger("stepwise.stdb")


class Stdb:
    def __init__(self, cfg: dict, token_file: Path | None = None, name: str = "Edge app (laptop)") -> None:
        c = cfg["spacetimedb"]
        if c.get("target") == "maincloud":
            self.uri = os.getenv("SPACETIMEDB_HOST", "https://maincloud.spacetimedb.com").rstrip("/")
            self.db = os.getenv("SPACETIMEDB_MODULE", "")
        else:
            self.uri, self.db = c["local_uri"].rstrip("/"), c["local_db"]
        self._http = httpx.Client(base_url=self.uri, timeout=10)
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="stdb")
        self._auth: dict[str, str] = {}
        self._pending: set[Future] = set()
        self.error: str | None = None
        self.token_file = token_file
        self.name = name
        self.registered = False
        self.connect()
        self.register()
        threading.Thread(target=self._heartbeat_loop, daemon=True, name="stdb-heartbeat").start()

    def connect(self) -> bool:
        try:
            saved = self._load_token()
            if saved:
                self._auth = {"Authorization": f"Bearer {saved}"}
                self.error = None
                return True
            r = self._http.post("/v1/identity")
            r.raise_for_status()
            token = r.json()["token"]
            self._auth = {"Authorization": f"Bearer {token}"}
            self._save_token(token)
            self.error = None
            return True
        except Exception as e:
            self.error = f"SpacetimeDB unreachable at {self.uri}: {type(e).__name__}"
            return False

    def _load_token(self) -> str | None:
        try:
            if self.token_file and self.token_file.exists():
                return json.loads(self.token_file.read_text()).get(self.db_key()) or None
        except (OSError, ValueError):
            pass
        return None

    def _save_token(self, token: str) -> None:
        if not self.token_file:
            return
        try:
            d = json.loads(self.token_file.read_text()) if self.token_file.exists() else {}
        except (OSError, ValueError):
            d = {}
        d[self.db_key()] = token
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        self.token_file.write_text(json.dumps(d))
        os.chmod(self.token_file, 0o600)

    def db_key(self) -> str:
        return f"{self.uri}/{self.db}"

    def register(self) -> bool:
        """Become the trusted edge device (only the edge may record step outcomes) and start the schedules."""
        ok, msg = self.call_sync("register_device", "edge", self.name, "")
        if ok:
            self.call_sync("ensure_schedules")
            self.registered = True
        else:
            log.warning("edge registration pending: %s", msg)
        return ok

    def _heartbeat_loop(self) -> None:
        while True:
            time.sleep(10)
            if not self.registered:
                self.register()
            else:
                self.call_sync("heartbeat")

    def mastery_levels(self, worker_id: str, task_id: str, timeout: float = 0.3) -> dict[int, int]:
        """Support level per step for this worker and task (fading). Short timeout: on any problem the
        caller falls back to full support, which is always safe."""
        wid, tid = worker_id.replace("'", ""), task_id.replace("'", "")
        r = self._http.post(f"/v1/database/{self.db}/sql", content=f"SELECT step_id, level FROM mastery WHERE worker_id = '{wid}' AND task_id = '{tid}'", headers=self._auth, timeout=timeout)
        r.raise_for_status()
        t = r.json()[0]
        cols = [e["name"].get("some", "") for e in t["schema"]["elements"]]
        return {int(row[cols.index("step_id")]): int(row[cols.index("level")]) for row in t["rows"]}

    def public(self) -> dict:
        ws = self.uri.replace("https://", "wss://").replace("http://", "ws://")
        return {"uri": ws, "db": self.db, "ok": self.error is None}

    def call_sync(self, reducer: str, *args) -> tuple[bool, str]:
        if not self._auth and not self.connect():
            return False, self.error or "not connected"
        try:
            r = self._http.post(f"/v1/database/{self.db}/call/{reducer}", json=list(args), headers=self._auth)
            if r.status_code == 200:
                return True, ""
            return False, r.text[:200]
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    def call(self, reducer: str, *args) -> None:
        """Fire and forget. Failures are logged, never raised into the hot path."""

        def run():
            ok, msg = self.call_sync(reducer, *args)
            if not ok:
                log.warning("reducer %s failed: %s", reducer, msg)

        f = self._pool.submit(run)
        self._pending.add(f)
        f.add_done_callback(self._pending.discard)

    def drain(self, timeout: float = 2.0) -> None:
        """Wait (briefly) for fire-and-forget writes, e.g. before reading a session back for its summary."""
        if self._pending:
            wait(list(self._pending), timeout=timeout)

    def sql(self, query: str) -> list[dict]:
        """Read rows (SpacetimeDB SQL over HTTP) as dicts by column name. Off the hot path only."""
        if not self._auth and not self.connect():
            raise RuntimeError(self.error or "not connected")
        r = self._http.post(f"/v1/database/{self.db}/sql", content=query, headers=self._auth)
        r.raise_for_status()
        out: list[dict] = []
        for table in r.json():
            cols = [e["name"].get("some", "") if isinstance(e.get("name"), dict) else e.get("name", "") for e in table["schema"]["elements"]]
            out += [dict(zip(cols, row)) for row in table["rows"]]
        return out
