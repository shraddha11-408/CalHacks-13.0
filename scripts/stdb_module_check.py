"""SpacetimeDB module checks: roles, fading rules, coach override, per-identity views, scheduled jobs, voice-agent calls.

Publishes the module to a SEPARATE local database (stepwise-test, wiped each run) so the real `stepwise`
data and the running edge app are never touched. Needs `spacetime start` on :3000.
Run: .venv/bin/python scripts/stdb_module_check.py
"""
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BASE, DB = "http://127.0.0.1:3000", "stepwise-test"
c = httpx.Client(base_url=BASE, timeout=10)
fails = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global fails
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def ident() -> dict:
    return {"Authorization": f"Bearer {c.post('/v1/identity').json()['token']}"}


def call(who: dict, reducer: str, *args) -> int:
    return c.post(f"/v1/database/{DB}/call/{reducer}", json=list(args), headers=who).status_code


def sql(q: str, who: dict) -> list[dict]:
    r = c.post(f"/v1/database/{DB}/sql", content=q, headers=who)
    r.raise_for_status()
    t = r.json()[0]
    cols = [e["name"]["some"] for e in t["schema"]["elements"]]
    return [dict(zip(cols, row)) for row in t["rows"]]


subprocess.run(["spacetime", "publish", DB, "--server", "local", "--delete-data=always", "--yes"], cwd=ROOT / "spacetime", check=True, capture_output=True)
edge, coach, buddy, outsider, screen = ident(), ident(), ident(), ident(), ident()
W, T, S = "w1", "task1", 1
key = f"{W}|{T}|{S}"
lvl = lambda: sql(f"SELECT level FROM mastery WHERE key = '{key}'", edge)[0]["level"]  # noqa: E731

check("edge registers", call(edge, "register_device", "edge", "edge", "") == 200)
check("a second active edge is refused", call(outsider, "register_device", "edge", "x", "") != 200)
check("supervisor registers", call(coach, "register_device", "supervisor", "Coach Ana", "") == 200)
check("buddy registers", call(buddy, "register_device", "buddy", "Sam", "") == 200)
check("non-edge cannot record outcomes", call(outsider, "record_step_outcome", "s", W, T, S, "clean") != 200)
for _ in range(3):
    call(edge, "record_step_outcome", "s1", W, T, S, "clean")
check("3 clean in a row → level 1", lvl() == 1, lvl())
for o in ("error", "clean", "error"):
    call(edge, "record_step_outcome", "s2", W, T, S, o)
check("2 errors in the last 5 → back to level 0", lvl() == 0, lvl())
check("buddy cannot override", call(buddy, "set_support_level", W, T, S, 3) != 200)
check("coach can override", call(coach, "set_support_level", W, T, S, 2) == 200 and lvl() == 2)
reasons = [r["reason"] for r in sql(f"SELECT reason FROM step_outcome WHERE worker_id = '{W}'", edge) if r["reason"]]
check("history records promote, demote, coach", reasons == ["promote", "demote", "coach"], reasons)
call(screen, "register_device", "worker_screen", "screen", W)
check("my_mastery: worker screen sees its worker's rows", len(sql("SELECT * FROM my_mastery", screen)) == 1)
check("my_mastery: other identities see none", len(sql("SELECT * FROM my_mastery", coach)) == 0)
call(edge, "request_help", "s3", W, T, S, "")
hid = sql(f"SELECT id FROM help_request WHERE session_id = 's3'", edge)[0]["id"]
check("help goes to buddies first", sql(f"SELECT routed_to FROM help_route WHERE help_id = {hid}", edge)[0]["routed_to"] == "buddy")
# Layer E · voice agent: the screen that starts a call owns it; transcripts reach supervisors only
check("buddy cannot start a call", call(buddy, "agent_call_start", "callX", "s4", T, "av_1", "Ana") != 200)
check("worker screen starts a call", call(screen, "agent_call_start", "call1", "s4", T, "av_1", "Ana") == 200)
row = sql("SELECT * FROM agent_call WHERE call_id = 'call1'", edge)
check("the call's worker comes from the device row, not the caller", row and row[0]["worker_id"] == W, row and row[0]["worker_id"])
check("owner logs the worker's turn", call(screen, "agent_turn_log", "call1", 1, "user", "What do I do?", False, 0) == 200)
check("owner logs the coach's turn", call(screen, "agent_turn_log", "call1", 2, "assistant", "Pick up the cup.", False, 1200) == 200)
check("owner logs a tool call", call(screen, "agent_tool_log", "call1", "tc1", "check_my_work", "{}", "Done!", True, 1500) == 200)
check("another identity cannot write into the call", call(coach, "agent_turn_log", "call1", 3, "user", "spoof", False, 0) != 200)
check("supervisor_transcript: supervisor sees the 2 turns", len(sql("SELECT * FROM supervisor_transcript", coach)) == 2)
check("supervisor_transcript: buddy sees none", len(sql("SELECT * FROM supervisor_transcript", buddy)) == 0)
check("supervisor_tool_calls: worker screen sees none", len(sql("SELECT * FROM supervisor_tool_calls", screen)) == 0)
try:
    sql("SELECT * FROM agent_turn", buddy)
    private = False
except httpx.HTTPStatusError:
    private = True
check("agent_turn is private (direct SQL refused)", private)
check("buddy cannot end a call", call(buddy, "coach_end_call", "call1") != 200)
check("coach ends the call from the floor", call(coach, "coach_end_call", "call1") == 200)
row = sql("SELECT status, end_reason FROM agent_call WHERE call_id = 'call1'", edge)[0]
check("call is ended, by the coach", row["status"] == "ended" and row["end_reason"] == "coach:Coach Ana", row)
check("no writes after the call ended", call(screen, "agent_turn_log", "call1", 3, "user", "late", False, 0) != 200)
call(screen, "agent_call_start", "call2", "s5", T, "av_1", "Ana")  # left live, owner never comes back
call(edge, "ensure_schedules")
time.sleep(21)
check("unclaimed after 20 s → supervisor (scheduled reducer)", sql(f"SELECT routed_to FROM help_route WHERE help_id = {hid}", edge)[0]["routed_to"] == "supervisor")
check("rollup filled worker_progress (scheduled reducer)", len(sql(f"SELECT * FROM worker_progress WHERE worker_id = '{W}'", edge)) == 1)
st = sql(f"SELECT * FROM agent_stats WHERE worker_id = '{W}'", edge)
time.sleep(21)  # past the 30 s silence window, plus one sweep
check("silent live call of an offline screen → dropped (presence sweep)", sql("SELECT status FROM agent_call WHERE call_id = 'call2'", edge)[0]["status"] == "dropped")
check("rollup filled agent_stats with measured numbers", st and st[0]["turns"] == 2 and st[0]["checks"] == 1 and st[0]["p_50_response_ms"] == 1200, st)
print(f"\n{'all passed' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
