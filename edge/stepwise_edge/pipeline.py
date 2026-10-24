"""Camera → gate → ArUco detect → rectify, on one background thread.

Every frame: gate update, marker detection, and (if all 4 markers are visible)
a rectified tray image for the live view. Only when the gate fires does a
check happen: no markers → event "look_at_tray" and no check; markers → event
"check_ready" with the rectified frame (the cascade plugs in here next).

The raw frame never leaves this process; only the rectified tray will be sent
to cloud models (AGENTS.md §2).
"""
from __future__ import annotations

import collections
import threading
import time

import cv2
import numpy as np

from cvlib import detect, homography, warp

from .camera import CameraSource
from .events import EventBus
from .gating import FrameGate

GATE_COLORS = {"moving": (40, 140, 240), "settling": (60, 190, 230), "settled": (90, 180, 60)}  # BGR


class Pipeline:
    def __init__(self, camera: CameraSource, cfg: dict, bus: EventBus) -> None:
        ws = cfg["workspace"]
        self.camera, self.bus = camera, bus
        self.ids = tuple(ws["marker_ids"])
        self.size = tuple(ws["rectified_size"])
        self.gate = FrameGate.from_config(cfg["thresholds"])
        self._lock = threading.Lock()
        self.raw: np.ndarray | None = None  # annotated raw frame (local view only)
        self.tray: np.ndarray | None = None  # latest rectified tray
        self.check_frame: np.ndarray | None = None  # rectified frame of the last check
        self.markers: list[int] = []
        self.gate_state = "settling"
        self.lat = collections.deque(maxlen=300)  # gate + detect + rectify per frame (ms)
        self.checks = 0
        self.fps = 0.0
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> "Pipeline":
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="pipeline", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def stats(self) -> dict:
        lat = sorted(self.lat)
        pick = lambda p: round(lat[min(int(len(lat) * p), len(lat) - 1)], 2) if lat else None  # noqa: E731
        return {
            "camera": self.camera.name,
            "camera_error": self.camera.error,
            "fps": round(self.fps, 1),
            "gate_state": self.gate_state,
            "markers": self.markers,
            "checks": self.checks,
            "gate_rectify_ms_p50": pick(0.5),
            "gate_rectify_ms_p99": pick(0.99),
            "samples": len(lat),
        }

    def latest(self, which: str) -> np.ndarray | None:
        with self._lock:
            return {"raw": self.raw, "tray": self.tray, "check": self.check_frame}[which]

    def process(self, frame: np.ndarray, ts: float) -> dict:
        """One frame through gate → detect → rectify. Returns what happened (used by tests too)."""
        t0 = time.perf_counter()
        g = self.gate.update(frame, ts)
        found = detect(frame)
        H = homography(found, self.ids, self.size)
        tray = warp(frame, H, self.size) if H is not None else None
        ms = (time.perf_counter() - t0) * 1000
        event = None
        if g.fire:
            if tray is None:
                event = self.bus.publish("look_at_tray", markers=sorted(found), say="Look at the tray, please.")
            else:
                self.checks += 1
                event = self.bus.publish("check_ready", n=self.checks, latency_ms=round(ms, 2))
        if g.state != self.gate_state:
            self.bus.publish("gate", state=g.state, changed=round(g.changed, 4))
        return {"gate": g, "found": found, "tray": tray, "ms": ms, "event": event}

    def _annotate(self, frame: np.ndarray, out: dict) -> np.ndarray:
        img = frame.copy()
        found, g = out["found"], out["gate"]
        if found:
            ids = np.array(list(found), dtype=np.int32).reshape(-1, 1)
            cv2.aruco.drawDetectedMarkers(img, [found[i].reshape(1, 4, 2) for i in found], ids)
        H = homography(found, self.ids, self.size)
        if H is not None:  # outline the rectified work area on the raw view
            w, h = self.size
            box = cv2.perspectiveTransform(np.float32([[[0, 0], [w, 0], [w, h], [0, h]]]), np.linalg.inv(H))
            cv2.polylines(img, [box.astype(np.int32)], True, (200, 160, 0), 2)
        color = GATE_COLORS[g.state]
        cv2.rectangle(img, (0, 0), (img.shape[1], 34), (30, 30, 30), -1)
        cv2.putText(img, f"gate: {g.state}", (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
        bar = int(min(g.changed / max(self.gate.change_frac * 2, 1e-6), 1) * 140)
        cv2.rectangle(img, (190, 12), (190 + bar, 24), color, -1)
        cv2.rectangle(img, (190, 12), (330, 24), (120, 120, 120), 1)
        cv2.putText(img, f"markers {sorted(found) or '-'}  {out['ms']:.1f} ms", (345, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (230, 230, 230), 1)
        return img

    def _loop(self) -> None:
        n, t_fps = 0, time.monotonic()
        while self._running:
            got = self.camera.read(timeout=1.0)
            if got is None:
                continue
            frame, ts = got
            out = self.process(frame, ts)
            raw = self._annotate(frame, out)
            with self._lock:
                self.raw = raw
                self.tray = out["tray"]
                if out["event"] and out["event"]["type"] == "check_ready":
                    self.check_frame = out["tray"]
            self.markers = sorted(m for m in out["found"] if m in self.ids)
            self.gate_state = out["gate"].state
            self.lat.append(out["ms"])
            n += 1
            if time.monotonic() - t_fps >= 1.0:
                self.fps, n, t_fps = n / (time.monotonic() - t_fps), 0, time.monotonic()
