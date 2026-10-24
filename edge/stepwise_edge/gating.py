"""Frame gating (AGENTS.md §6 step 1): check only after the scene changed and then settled.

Works on a small blurred grayscale copy. The signal is the share of pixels
whose value changed by more than `pixel_delta` since the previous frame — a
hand moving through one slot is a large local change but a tiny mean change,
so a mean-diff threshold would miss it. Two thresholds give hysteresis:
above `change_frac` the scene is moving; below `still_frac` it is still.

States: settled → moving → settling → (still for settle_s) → emits one check → settled.
The very first still period also emits a check, so a tray already in place gets checked.
Pure logic with injected timestamps, so it is unit-testable without a camera.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class GateResult:
    state: str  # "moving" | "settling" | "settled"
    changed: float  # share of pixels changed vs previous frame (0–1)
    fire: bool  # True exactly once per settle → run a check now


class FrameGate:
    def __init__(
        self,
        settle_s: float = 0.5,
        pixel_delta: int = 25,
        change_frac: float = 0.02,
        still_frac: float = 0.005,
        size: tuple[int, int] = (160, 120),
    ) -> None:
        assert still_frac <= change_frac
        self.settle_s, self.pixel_delta = settle_s, pixel_delta
        self.change_frac, self.still_frac = change_frac, still_frac
        self.size = tuple(size)
        self._prev: np.ndarray | None = None
        self._state = "settling"  # armed at start: first still period fires
        self._still_since: float | None = None

    @classmethod
    def from_config(cls, th: dict) -> "FrameGate":
        return cls(th["gate_settle_s"], th["gate_pixel_delta"], th["gate_change_frac"], th["gate_still_frac"], th["gate_size"])

    @property
    def state(self) -> str:
        return self._state

    def _small(self, frame: np.ndarray) -> np.ndarray:
        g = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        g = cv2.resize(g, self.size, interpolation=cv2.INTER_AREA)
        return cv2.GaussianBlur(g, (5, 5), 0)

    def update(self, frame: np.ndarray, ts: float) -> GateResult:
        small = self._small(frame)
        if self._prev is None:
            self._prev = small
            self._still_since = ts
            return GateResult(self._state, 0.0, False)
        diff = cv2.absdiff(small, self._prev)
        self._prev = small
        changed = float(np.count_nonzero(diff > self.pixel_delta)) / diff.size

        if changed > self.change_frac:
            self._state, self._still_since = "moving", None
            return GateResult("moving", changed, False)

        if changed < self.still_frac:
            if self._state == "moving":
                self._state, self._still_since = "settling", ts
            elif self._state == "settling":
                if self._still_since is None:
                    self._still_since = ts
                if ts - self._still_since >= self.settle_s:
                    self._state = "settled"
                    return GateResult("settled", changed, True)
            return GateResult(self._state, changed, False)

        # Between the thresholds: keep the current state, but a settling scene
        # restarts its still timer (it isn't clearly still yet).
        if self._state == "settling":
            self._still_since = ts
        return GateResult(self._state, changed, False)
