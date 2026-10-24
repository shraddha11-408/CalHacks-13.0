"""Coach session state and decision rules (PLAN.md §2–§3). Pure logic, unit-tested.

- done        → "Great!" + next instruction
- mistake     → correction, log it, save a memory note
- in_progress → stay quiet
- unclear, or low confidence, N times in a row on a step → ask Claude with the last 3 frames
"""
from __future__ import annotations

import collections
import re
import time
import uuid
from dataclasses import dataclass, field

INTENTS = [
    ("help", r"\b(help|stuck|can'?t do|cannot do)\b"),
    ("check", r"\b(is (this|it|that) (correct|right|ok|okay|good)|did i do it|check|done|finished|i'?m done)\b"),
    ("why", r"\bwhy\b"),
    ("repeat", r"\b(again|repeat|say that|what did you say|didn'?t hear)\b"),
    ("next", r"\b(what'?s next|next|what now|what do i do)\b"),
]


def intent_of(said: str) -> str:
    s = said.lower()
    for name, pat in INTENTS:
        if re.search(pat, s):
            return name
    return "open"


def spoken_tip(correction: str) -> str:
    """'Almost. Smooth it out.' → 'Remember: smooth it out.'"""
    tip = re.sub(r"^\s*almost[.!,]?\s*", "", correction, flags=re.I).strip()
    if not tip:
        return ""
    return "Remember: " + tip[0].lower() + tip[1:]


@dataclass
class CoachSession:
    worker_id: str
    worker_name: str
    task: dict
    id: str = field(default_factory=lambda: "s_" + uuid.uuid4().hex[:10])
    step_index: int = 0
    unclear: int = 0
    snapshots: collections.deque = field(default_factory=lambda: collections.deque(maxlen=3))
    last_said: str = ""
    started: float = field(default_factory=time.time)
    finished: bool = False
    done_streak: int = 0
    last_done_at: float = 0.0

    @property
    def steps(self) -> list[dict]:
        return self.task["steps"]

    @property
    def step(self) -> dict:
        return self.steps[min(self.step_index, len(self.steps) - 1)]

    def classify(self, result: dict, low_conf: float, done_conf: float | None = None) -> str:
        """done/mistake with low confidence count as unclear: silence beats a wrong correction."""
        s = result.get("status", "unclear")
        c = float(result.get("confidence", 0))
        if s == "mistake" and c < low_conf:
            return "unclear"
        if s == "done" and c < (done_conf if done_conf is not None else low_conf):
            return "unclear"
        return s

    def note_done(self, now: float, need: int, min_gap: float) -> bool:
        """Debounce: True only on the `need`-th consecutive done, each at least min_gap apart."""
        if self.done_streak and now - self.last_done_at < min_gap:
            return False  # too soon to count as a second look
        self.done_streak += 1
        self.last_done_at = now
        return self.done_streak >= need

    def not_done(self) -> None:
        self.done_streak = 0

    def note_unclear(self, escalate_after: int) -> bool:
        """Count an unclear result. True when it's time to ask Claude."""
        self.unclear += 1
        return self.unclear >= escalate_after

    def advance(self) -> bool:
        """Move to the next step. Returns True when the task is finished."""
        self.unclear = 0
        self.done_streak = 0
        self.snapshots.clear()
        if self.step_index + 1 >= len(self.steps):
            self.finished = True
            return True
        self.step_index += 1
        return False
