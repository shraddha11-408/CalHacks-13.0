#!/usr/bin/env python3
"""Validate proposed.json for a Droid re-teach job (stdlib only).

Prints "validate: pass" (exit 0) or "validate: <first failure>" (exit 1).
Optional: a line "Names: A, B" in evidence.md lists real names no field may mention.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIELDS = ["instruction", "done_right", "common_mistake", "correction", "why", "praise", "cue"]
URL_RE = re.compile(r"(https?://|www\.|<[a-zA-Z/][^>]*>)")


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def words(s):
    return [w for w in re.split(r"\s+", s.strip()) if w]


def forbidden_names():
    path = os.path.join(HERE, "evidence.md")
    names = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^\s*[-*]?\s*\**Names\**\s*:\s*(.*)$", line, re.I)
                if m:
                    names += [n.strip() for n in re.split(r"[,;]", m.group(1)) if n.strip()]
    except OSError:
        pass
    return [n for n in names if len(n) >= 2]


def check():
    path = os.path.join(HERE, "proposed.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return "proposed.json not found"
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return f"proposed.json does not parse ({e})"
    if not isinstance(data, dict):
        return "proposed.json must be an object"
    steps = data.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 2:
        return "steps must be a list of 1 or 2 steps"
    why = data.get("why")
    if not isinstance(why, str) or not why.strip():
        return "why must be a non-empty string"
    names = forbidden_names()
    for i, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            return f"step {i} must be an object"
        for k in FIELDS:
            v = step.get(k)
            if not isinstance(v, str) or not v.strip():
                return f"step {i}: {k} must be a non-empty string"
        if not isinstance(step.get("close_look"), bool):
            return f"step {i}: close_look must be true or false"
        if not step["correction"].strip().startswith("Almost."):
            return f'step {i}: correction must start with "Almost."'
        if len(sentences(step["instruction"])) > 2:
            return f"step {i}: instruction has more than 2 sentences"
        for k in ("instruction", "cue"):
            for s in sentences(step[k]):
                if len(words(s)) > 14:
                    return f"step {i}: {k} has a sentence over 14 words: {s!r}"
        texts = [step[k] for k in FIELDS] + [why]
        for t in texts:
            if URL_RE.search(t):
                return f"step {i}: no URLs or HTML allowed: {t!r}"
            for n in names:
                if re.search(r"\b" + re.escape(n) + r"\b", t, re.I):
                    return f"step {i}: mentions a real name ({n})"
    return None


if __name__ == "__main__":
    err = check()
    print("validate: pass" if err is None else f"validate: {err}")
    sys.exit(0 if err is None else 1)
