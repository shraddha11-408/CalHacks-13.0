"""SpacetimeDB over HTTP (PLAN.md: SpacetimeDB replaces Convex).

Writes are fire-and-forget on a small thread pool: the coach loop never waits
on the database. The edge gets its own identity at startup; the token stays in
memory and is never logged.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import Future, ThreadPoolExecutor, wait

import httpx

log = logging.getLogger("stepwise.stdb")


class Stdb:
    def __init__(self, cfg: dict) -> None:
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
        self.connect()

    def connect(self) -> bool:
        try:
            r = self._http.post("/v1/identity")
            r.raise_for_status()
            self._auth = {"Authorization": f"Bearer {r.json()['token']}"}
            self.error = None
            return True
        except Exception as e:
            self.error = f"SpacetimeDB unreachable at {self.uri}: {type(e).__name__}"
            return False

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
