"""Shared helpers for kill-tests. Each test records one row in results.json.

Never print or log key values. Only key *names* may appear in messages.
"""
from __future__ import annotations

import json
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
RESULTS = Path(__file__).resolve().parent / "results.json"
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / "cvlib"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")


def env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if not v:
        raise SystemExit(record(name_of_caller(), "fail", f"{name} is empty in .env"))
    return v


def name_of_caller() -> str:
    return Path(sys.argv[0]).stem.removeprefix("kt_")


def record(test: str, status: str, detail: str, timings: dict | None = None, extra: dict | None = None) -> int:
    """status: pass | fail | partial. Returns a process exit code."""
    data = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    data[test] = {
        "status": status,
        "detail": detail,
        "timings_ms": {k: round(v, 1) for k, v in (timings or {}).items()},
        "extra": extra or {},
        "ran_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    RESULTS.write_text(json.dumps(data, indent=2))
    mark = {"pass": "PASS", "fail": "FAIL", "partial": "PARTIAL"}[status]
    t = ", ".join(f"{k}={v:.1f}ms" for k, v in (timings or {}).items())
    print(f"[{mark}] {test}: {detail}" + (f"  ({t})" if t else ""))
    return 0 if status == "pass" else 1


@contextmanager
def timer(store: dict, key: str):
    t0 = time.perf_counter()
    yield
    store[key] = (time.perf_counter() - t0) * 1000


def pctl(xs: list[float], p: float) -> float:
    s = sorted(xs)
    k = (len(s) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)
