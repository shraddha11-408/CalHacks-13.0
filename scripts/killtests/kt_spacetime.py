"""Kill-test 5: SpacetimeDB on Maincloud, called from Python over the HTTP API.

Assumes spacetime/ is published as SPACETIMEDB_MODULE (scripts/killtests/run_all.sh
publishes it first). Steps:
  1. POST /v1/identity → a fresh identity + token for this test "device".
  2. POST /v1/database/<db>/call/register_device  (reducer)
  3. POST /v1/database/<db>/call/log_verdict      (reducer), timed x10
  4. POST /v1/database/<db>/call/outbound_ping_proc (procedure → outbound HTTP)
  5. POST /v1/database/<db>/sql to read the rows back.
The token is never printed or saved.
"""
import json
import time

import httpx

from common import env, pctl, record

HOST = env("SPACETIMEDB_HOST").rstrip("/")
DB = env("SPACETIMEDB_MODULE")
t: dict[str, float] = {}
extra: dict = {"database": DB}

with httpx.Client(base_url=HOST, timeout=30) as http:
    t0 = time.perf_counter()
    r = http.post("/v1/identity")
    t["create_identity"] = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise SystemExit(record("spacetime", "fail", f"POST /v1/identity → {r.status_code}", t))
    token = r.json()["token"]
    auth = {"Authorization": f"Bearer {token}"}

    def call(name: str, args: list) -> httpx.Response:
        return http.post(f"/v1/database/{DB}/call/{name}", json=args, headers=auth)

    t0 = time.perf_counter()
    r = call("register_device", ["glasses_edge", "killtest laptop"])
    t["register_device"] = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        raise SystemExit(record("spacetime", "fail", f"register_device → {r.status_code}: {r.text[:160]}", t, extra))

    lat = []
    for i in range(10):
        t0 = time.perf_counter()
        r = call("log_verdict", ["killtest", "s1", "checker", "done", 0.96, 14, 0.0])
        lat.append((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            raise SystemExit(record("spacetime", "fail", f"log_verdict → {r.status_code}: {r.text[:160]}", t, extra))
    t["log_verdict_p50"] = pctl(lat, 50)
    t["log_verdict_p99"] = pctl(lat, 99)

    t0 = time.perf_counter()
    r = call("outbound_ping_proc", ["https://www.cloudflare.com/cdn-cgi/trace"])
    t["procedure_outbound_http"] = (time.perf_counter() - t0) * 1000
    proc_ok = r.status_code == 200
    extra["procedure_response"] = r.text[:160]
    if proc_ok:
        try:
            body = r.json()
            proc_ok = (body.get("status") if isinstance(body, dict) else body[0]) == 200
        except (ValueError, KeyError, IndexError, TypeError):
            pass

    r = http.post(f"/v1/database/{DB}/sql", content="SELECT * FROM step_event WHERE session_id = 'killtest'; SELECT * FROM outbound_ping", headers=auth)
    rows = [len(stmt.get("rows", [])) for stmt in r.json()] if r.status_code == 200 else []
    extra["rows_step_event"], extra["rows_outbound_ping"] = (rows + [None, None])[:2]

detail = f"reducers OK (log_verdict p50 {t['log_verdict_p50']:.0f} ms); procedure outbound HTTP {'OK' if proc_ok else 'FAILED'}; rows step_event={extra['rows_step_event']} outbound_ping={extra['rows_outbound_ping']}"
raise SystemExit(record("spacetime", "pass" if proc_ok else "partial", detail, t, extra))
