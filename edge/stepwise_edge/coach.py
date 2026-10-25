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
    ("help", r"\b(help|can'?t do|cannot do|get my supervisor)\b"),
    ("check", r"\b(is (this|it|that) (correct|right|ok|okay|good)|did i do it|check|done|finished|i'?m done)\b"),
    ("stuck", r"\b(stuck|i don'?t (know|get it|understand)|confused|how do i( do)? (this|it))\b"),
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


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z']+", s.lower()))


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
    done_through: int = 0  # live check: steps the model saw finished (1-based), for skipping ahead
    mistake_streak: int = 0
    last_correction_at: float = -1e9
    step_started_at: float = field(default_factory=time.monotonic)  # for "stuck" guidance
    stuck_level: int = 0
    praise_i: int = 0
    levels: dict = field(default_factory=dict)  # step id → support level 0–3 (fading; SpacetimeDB is the authority)
    flags: dict = field(default_factory=dict)  # step id → what happened on it this session (decides its outcome)
    spoken: collections.deque = field(default_factory=lambda: collections.deque(maxlen=12))  # (t, text) the app said
    last_done_at: float = 0.0
    talk_log: collections.deque = field(default_factory=lambda: collections.deque(maxlen=4))  # (worker said, coach answered)
    last_seen: str = ""  # the live check's latest result, as the screen shows it (for spoken answers)

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

    def note_mistake(self, now: float, need: int, cooldown: float) -> str:
        """AGENTS.md §6: correct only after `need` mistakes in a row, at most once per `cooldown` s.
        Returns 'wait' (not sure yet), 'speak' (say the correction) or 'quiet' (already said it)."""
        self.mistake_streak += 1
        if self.mistake_streak < need:
            return "wait"
        if now - self.last_correction_at < cooldown:
            return "quiet"
        self.last_correction_at = now
        return "speak"

    def not_mistake(self) -> None:
        self.mistake_streak = 0

    def note_unclear(self, escalate_after: int) -> bool:
        """Count an unclear result. True when it's time to ask Claude."""
        self.unclear += 1
        return self.unclear >= escalate_after

    def level_of(self, step: dict | None = None) -> int:
        """0 full instruction · 1 short cue · 2 alerts only · 3 independent."""
        return int(self.levels.get(int((step or self.step)["id"]), 0))

    def flag(self, key: str, step: dict | None = None) -> None:
        f = self.flags.setdefault(int((step or self.step)["id"]), {"corrections": 0, "help": 0, "hinted": 0})
        f[key] += 1

    def outcome(self, step_id: int, by_hand: bool = False) -> str:
        """clean: done with no correction, hint or help · error: a correction or a help request ·
        assisted: a hint, or moved on by hand. Only clean runs move a step toward independence."""
        f = self.flags.get(int(step_id), {})
        if f.get("corrections") or f.get("help"):
            return "error"
        if by_hand or f.get("hinted"):
            return "assisted"
        return "clean"

    def new_step(self) -> None:
        """Restart the stuck timer (advance, or the worker moved by hand)."""
        self.step_started_at = time.monotonic()
        self.stuck_level = 0

    def stuck_due(self, now: float, after_s: list[float]) -> int | None:
        """Next stuck level whose time has come (0, 1, 2…), or None. Each level fires once per step."""
        if self.stuck_level < len(after_s) and now - self.step_started_at >= after_s[self.stuck_level]:
            self.stuck_level += 1
            return self.stuck_level - 1
        return None

    def note_spoken(self, texts: list[str], now: float | None = None) -> None:
        t = time.monotonic() if now is None else now
        for x in texts:
            if x:
                self.spoken.append((t, x))

    def is_echo(self, said: str, now: float | None = None, window_s: float = 20.0) -> bool:
        """The always-on mic heard the app's own voice: most of the words match something said recently."""
        t = time.monotonic() if now is None else now
        heard = _words(said)
        if not heard:
            return True
        for at, text in self.spoken:
            if t - at > window_s:
                continue
            ours = _words(text)
            if ours and len(heard & ours) / len(heard) >= 0.7:
                return True
        return False

    def advance(self) -> bool:
        """Move to the next step. Returns True when the task is finished."""
        self.unclear = 0
        self.done_streak = 0
        self.done_through = 0
        self.mistake_streak = 0
        self.last_correction_at = -1e9
        self.new_step()
        self.snapshots.clear()
        if self.step_index + 1 >= len(self.steps):
            self.finished = True
            return True
        self.step_index += 1
        return False
