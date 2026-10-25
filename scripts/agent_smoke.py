"""Voice agent smoke test, no microphone: the same path the worker screen takes.

Starts a coach session on the edge app, gets an agent token (POST /coach/{sid}/agent), opens Cartesia's agent
WebSocket with the token (as a browser would), speaks a question made with Cartesia TTS, runs every client tool
call through the edge app (POST /coach/{sid}/agent/tool), and prints the turns with measured timings.

  .venv/bin/python scripts/agent_smoke.py ["What step am I on?"]
Asking for a person sends a real help alert (worker "Agent Smoke"); resolve it on the supervisor page.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]
EDGE = "http://127.0.0.1:8000"
RATE = 24000
CHUNK = RATE * 2 // 50  # 20 ms of 16-bit mono


def load_env() -> None:
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def speech(text: str) -> bytes:
    from cartesia import Cartesia

    r = Cartesia(api_key=os.environ["CARTESIA_API_KEY"]).tts.generate(
        model_id="sonic-3", transcript=text, voice={"mode": "id", "id": "6c756032-11c3-4be8-a120-74f9673fb700"},
        output_format={"container": "raw", "encoding": "pcm_s16le", "sample_rate": RATE}, language="en",
    )
    return r.read()


async def main(question: str) -> None:
    load_env()
    http = httpx.Client(base_url=EDGE, timeout=30)
    task = http.get("/tasks").json()[0]
    sess = http.post("/coach/start", json={"worker_name": "Agent Smoke", "task_id": task["task_id"]}).json()
    sid = sess["session_id"]
    a = http.post(f"/coach/{sid}/agent").json()
    print(f"task: {task['title']} · agent {a['agent_id']} · voice {a['voice']['name']}")
    audio = speech(question)
    silence = bytes(CHUNK)
    t0 = time.perf_counter()
    async with websockets.connect(a["url"] + "&access_token=" + a["token"], max_size=4 << 20) as ws:
        await ws.send(json.dumps({"type": "session_create", "audio": {"input_format": f"pcm_{RATE}", "output_delivery": "as_available", "continuous_input": True}}))
        spoke = asyncio.Event()
        out_bytes = 0
        last_user_end = None
        turns: list[str] = []

        async def mic() -> None:
            await spoke.wait()  # after the greeting, ask the question, then keep streaming silence
            await asyncio.sleep(0.5)
            for i in range(0, len(audio), CHUNK):
                await ws.send(json.dumps({"type": "audio_input", "audio": base64.b64encode(audio[i : i + CHUNK]).decode()}))
                await asyncio.sleep(0.02)
            while True:
                await ws.send(json.dumps({"type": "audio_input", "audio": base64.b64encode(silence).decode()}))
                await asyncio.sleep(0.02)

        mic_task = asyncio.create_task(mic())
        assistant_turns = 0
        try:
            async for raw in ws:
                ev = json.loads(raw)
                ty = ev["type"]
                ms = round((time.perf_counter() - t0) * 1000)
                if ty == "session_ready":
                    print(f"[{ms:>5} ms] session_ready call={ev['call_id']} version={ev.get('agent_version_id')}")
                elif ty == "audio_output":
                    out_bytes += len(base64.b64decode(ev["audio"]))
                elif ty == "turn_started":
                    extra = f" (response {round((ev['start_time'] - last_user_end) * 1000)} ms after the worker stopped)" if ev["role"] == "assistant" and last_user_end is not None else ""
                    print(f"[{ms:>5} ms] turn {ev['turn']} {ev['role']} started{extra}")
                elif ty == "turn_ended":
                    print(f"[{ms:>5} ms] turn {ev['turn']} {ev['role']}: {ev.get('text')!r}" + (" (interrupted)" if ev.get("interrupted") else ""))
                    turns.append(ev["role"])
                    if ev["role"] == "user":
                        last_user_end = ev.get("end_time")
                    elif ev.get("text"):
                        assistant_turns += 1
                        spoke.set()
                        if assistant_turns >= 2:  # the greeting, then the answer
                            break
                elif ty == "client_tool_call":
                    t1 = time.perf_counter()
                    r = http.post(f"/coach/{sid}/agent/tool", json={"tool": ev["tool_name"], "parameters": ev.get("parameters") or {}}).json()
                    if ev.get("expects_response"):
                        await ws.send(json.dumps({"type": "client_tool_result", "tool_call_id": ev["tool_call_id"], "result": r["result"], "is_error": not r["ok"]}))
                    print(f"[{ms:>5} ms] tool {ev['tool_name']}({ev.get('parameters')}) → {r['result'][:120]!r} [{round((time.perf_counter() - t1) * 1000)} ms]")
                elif ty == "error":
                    print(f"[{ms:>5} ms] ERROR {ev}")
                elif ty not in ("turn_output_text_delta", "audio_output_clear"):
                    print(f"[{ms:>5} ms] {ty}")
        finally:
            mic_task.cancel()
            await ws.close(1000, "smoke test done")
    print(f"agent audio received: {out_bytes / (RATE * 2):.1f} s")
    http.post(f"/coach/{sid}/end")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "What step am I on?"))
