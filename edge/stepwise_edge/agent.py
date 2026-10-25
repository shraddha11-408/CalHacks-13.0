"""Cartesia Managed Agent: a real conversation with the coach, in the coach's voice.

Cartesia runs listening, turn-taking, barge-in and the LLM (Claude Haiku in Cartesia's catalog). Its
tools are **client tools**: Cartesia sends `client_tool_call` over the worker screen's WebSocket, the
screen runs it against this edge app (camera check, help, steps, memory) and SpacetimeDB, and answers
with `client_tool_result`. So the agent never sees a camera frame or a key; it only gets tool results.

This module keeps the agent definition in code: the tools and one agent per voice (the task's consented
clone, or the stock voice) are created once over the REST API and patched when the definition changes.
IDs live in data/cartesia_agent.json. The browser gets only a short-lived access token (agent grant).
Docs: docs.cartesia.ai/agents (configuration, client-tools, line/integrations/websocket-api).
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path

import httpx

API = "https://api.cartesia.ai"
VERSION = "2026-08-14"
WS = "wss://api.cartesia.ai/v1/agents/websocket/{agent_id}?cartesia_version=" + VERSION
MODEL = "claude-haiku-5.5"  # Cartesia's managed catalog (GET /v1/agents/models): ~0.6 s average latency
TOKEN_TTL_S = 600


def _tool(name: str, description: str, props: dict | None = None, required: list[str] | None = None, *, speech: str = "off", timeout: int = 10, respond: bool = True, mode: str = "immediate") -> dict:
    t = {
        "type": "client",
        "name": name,
        "description": description,
        "pre_tool_speech": speech,
        "execution_mode": mode,
        "expects_response": respond,
        "parameters": {"type": "object", "properties": props or {}, **({"required": required} if required else {})},
    }
    if respond:
        t["response_timeout_secs"] = timeout
    return t


TOOLS = [
    _tool(
        "what_is_my_step",
        "Gets the worker's name, the task, all its steps, and the step they are on right now: what to do, why it matters, and how much help they get. "
        "Call it first in every conversation. Steps change while you talk, so call it again before you say what to do, how, or why.",
        timeout=5,
    ),
    _tool(
        "check_my_work",
        "Looks through the worker's camera and checks the step they are on. Use it when they ask if it is right, say they are done, "
        "or ask you to look. You cannot see anything without it. If the step is done, the task moves on by itself.",
        speech="force",  # "Let me look." while the camera check runs (~1.5 s)
        timeout=20,
    ),
    _tool(
        "call_a_helper",
        "Sends a help alert with a photo to a coworker's phone. If nobody answers in 20 seconds it goes to the supervisor. "
        "Use it when the worker asks for a person, is upset, or is still stuck after two tries.",
        {"reason": {"type": "string", "description": "A few words on why, like 'stuck on folding'."}},
        timeout=8,
    ),
    _tool(
        "my_progress",
        "Reads the job coach's records: for each step of this task, how much help the worker needs now, and what they did today. "
        "Use it when the worker asks how they are doing.",
        timeout=5,
    ),
    _tool(
        "change_step",
        "Moves to the next step or back one step, when the worker asks for it.",
        {"direction": {"type": "string", "enum": ["next", "back"], "description": "next or back"}},
        ["direction"],
        timeout=8,
    ),
    _tool(
        "remember",
        "Saves a short note for the job coach, about something the worker tells you about themselves (what they like, what is hard). "
        "Use it only when they tell you something like that.",
        {"note": {"type": "string", "description": "One plain sentence, in the worker's own words if you can."}},
        ["note"],
        respond=False,
        mode="async",
    ),
]

# No dynamic variables: Cartesia rejects them from browser access tokens. The agent learns who it is
# talking to, the task and the step from its first tool call (what_is_my_step), always fresh.
INSTRUCTIONS = """# Who you are
You are a warm job coach. You talk with a worker through their job-coach glasses while they do a task at work. The worker is a capable adult with an intellectual or developmental disability.

# First thing
Before you answer anything, call what_is_my_step. It tells you the worker's name, the task, every step, and the step they are on. Use their name sometimes.

# How you talk
- Very short: one or two short sentences. First-grade words. One action per sentence.
- Warm and calm. Praise real effort.
- Never say "wrong" or "no" by itself. Say "Almost." and then what to do.
- One question at a time. Then let them work. Do not chat while they work.

# Tools
- what_is_my_step: first, and again before you say what to do, how, or why. Steps change while you talk. Never guess the step.
- check_my_work: when they ask "is this right?", say they are done, or ask you to look. Say only what the result says. If the step is done, cheer, then say the next step in a few words.
- call_a_helper: when they ask for a person, are upset, or are still stuck after two tries. Then tell them help is coming.
- my_progress: when they ask how they are doing. Say the best true thing first.
- change_step: when they ask for the next step or to go back.
- remember: when they tell you something about themselves that the coach should know.

# Guardrails
You cannot see unless you call check_my_work. Never make up what the camera sees, a number, or a step. Anything unsafe or not about the task: call a helper. When they say bye or want to stop talking, say a short goodbye and end the call."""

INITIAL = "Hi! I'm listening. What do you need?"


def _hash(x) -> str:
    return hashlib.sha256(json.dumps(x, sort_keys=True).encode()).hexdigest()[:16]


class CartesiaAgent:
    def __init__(self, state_path: Path) -> None:
        self.path = state_path
        self._lock = threading.Lock()

    # ---- REST ----
    def _req(self, method: str, path: str, body: dict | None = None) -> dict:
        key = os.getenv("CARTESIA_API_KEY", "")
        if not key:
            raise RuntimeError("CARTESIA_API_KEY is not set")
        r = httpx.request(method, API + path, json=body, timeout=15, headers={"X-API-Key": key, "Cartesia-Version": VERSION})
        if r.status_code >= 400:
            raise RuntimeError(f"Cartesia {method} {path}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    def _state(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except Exception:
            return {"tools": {}, "agents": {}}

    def _save(self, st: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(st, indent=2))

    # ---- definition ----
    def _tool_ids(self, st: dict) -> list[str]:
        """Each tool is created once; a changed definition gets a new tool (old agent versions keep theirs)."""
        ids = []
        for t in TOOLS:
            h = _hash(t)
            have = st["tools"].get(t["name"])
            if not have or have["hash"] != h:
                made = self._req("POST", "/v1/agents/tools", t)
                have = st["tools"][t["name"]] = {"id": made["id"], "hash": h}
                self._save(st)
            ids.append(have["id"])
        return ids

    def _config(self, voice_id: str, tool_ids: list[str]) -> dict:
        return {
            "instructions": INSTRUCTIONS,
            "initial_message": INITIAL,
            "model": {"id": MODEL, "max_output_tokens": 300},
            "language": {"primary": "en"},
            "audio": {"input": {"noise_suppression": "auto"}, "output": {"voice_id": voice_id, "speed": 0.95}},
            # the worker is silent for long stretches while working: no check-ins (no nagging), end after 4 min
            "turn": {"inactivity_end_call_secs": 240, "inactivity_check_in_secs": None},
            "tools": [{"id": i} for i in tool_ids],
            "system_tools": {"end_call": {}, "skip_turn": {}},
        }

    def ensure(self, voice_id: str, voice_name: str) -> str:
        """The agent that speaks in this voice (created or updated as needed). Returns its agent_id."""
        with self._lock:
            st = self._state()
            cfg = self._config(voice_id, self._tool_ids(st))
            h = _hash(cfg)
            have = st["agents"].get(voice_id)
            name = f"IDD Help coach · {voice_name}"[:64]
            if not have:
                made = self._req("POST", "/v1/agents", {"name": name, "description": "Job coach voice agent for IDD Help (Cal Hacks).", "config": cfg})
                have = st["agents"][voice_id] = {"id": made["id"], "hash": h}
                self._save(st)
            elif have["hash"] != h:
                self._req("PATCH", f"/v1/agents/{have['id']}", {"config": cfg, "version_description": f"definition {h}"})
                have["hash"] = h
                self._save(st)
            return have["id"]

    def token(self) -> str:
        """Short-lived token that may only open an agent WebSocket (never the API key in the browser)."""
        return self._req("POST", "/access-token", {"grants": {"agent": True}, "expires_in": TOKEN_TTL_S})["token"]
