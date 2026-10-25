"""Camera sources behind one interface, chosen by devices.camera in config.yaml.

webcam     → LaptopWebcam (AVFoundation on macOS). The only device until the glasses exist.
pi_stream  → PiStream: MJPEG over HTTP from the Pi 5 + Brio 100 UVC webcam (hardware/camera/uvc_streamer.py).
file       → FileSource: loops an image or video (tests, eval clips). Env STEPWISE_CAMERA=file:<path>
             overrides config for a one-off run.

Each source runs its own capture thread and keeps only the newest frame, so a
slow consumer never builds up a backlog (the hot path wants the present, not the past).
"""
from __future__ import annotations

import abc
import threading
import time

import cv2
import numpy as np


class CameraSource(abc.ABC):
    """read() blocks until a frame newer than the last one returned is available."""

    name = "camera"

    def __init__(self) -> None:
        self._lock = threading.Condition()
        self._frame: np.ndarray | None = None
        self._ts = 0.0
        self._seq = 0
        self._last_read = 0
        self._running = False
        self._thread: threading.Thread | None = None
        self.error: str | None = None

    # -- subclass API --
    @abc.abstractmethod
    def _open(self) -> None: ...

    @abc.abstractmethod
    def _grab(self) -> np.ndarray | None: ...

    @abc.abstractmethod
    def _close(self) -> None: ...

    # -- public API --
    def start(self) -> "CameraSource":
        self._open()
        self._running = True
        self._thread = threading.Thread(target=self._loop, name=f"{self.name}-capture", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        self._close()

    def read(self, timeout: float = 2.0) -> tuple[np.ndarray, float] | None:
        with self._lock:
            ok = self._lock.wait_for(lambda: self._seq > self._last_read or not self._running, timeout)
            if not ok or self._frame is None:
                return None
            self._last_read = self._seq
            return self._frame, self._ts

    def _loop(self) -> None:
        failures = 0
        while self._running:
            frame = self._grab()
            if frame is None:
                failures += 1
                if failures > 30:
                    self.error = f"{self.name}: no frames"
                time.sleep(0.02)
                continue
            failures = 0
            self.error = None
            with self._lock:
                self._frame, self._ts, self._seq = frame, time.monotonic(), self._seq + 1
                self._lock.notify_all()
        with self._lock:
            self._lock.notify_all()


class LaptopWebcam(CameraSource):
    name = "webcam"

    def __init__(self, index: int = 0, size: tuple[int, int] = (640, 480)) -> None:
        super().__init__()
        self.index, self.size = index, size
        self._cap: cv2.VideoCapture | None = None

    def _open(self) -> None:
        self._cap = cv2.VideoCapture(self.index, cv2.CAP_AVFOUNDATION)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.size[0])
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.size[1])
        if not self._cap.isOpened():
            raise RuntimeError("Webcam did not open (System Settings → Privacy & Security → Camera)")

    def _grab(self) -> np.ndarray | None:
        ok, frame = self._cap.read() if self._cap else (False, None)
        return frame if ok else None

    def _close(self) -> None:
        if self._cap:
            self._cap.release()


class PiStream(CameraSource):
    """Pi 5 + Brio 100 UVC MJPEG stream (hardware/camera/uvc_streamer.py). Wired in the Hardware prompt."""

    name = "pi_stream"

    def __init__(self, url: str) -> None:
        super().__init__()
        self.url = url
        self._cap: cv2.VideoCapture | None = None

    def _open(self) -> None:
        self._cap = cv2.VideoCapture(self.url)
        if not self._cap.isOpened():
            raise RuntimeError(f"Pi stream not reachable at {self.url}")

    def _grab(self) -> np.ndarray | None:
        ok, frame = self._cap.read() if self._cap else (False, None)
        return frame if ok else None

    def _close(self) -> None:
        if self._cap:
            self._cap.release()


class FileSource(CameraSource):
    """Loops a still image or a video file at a fixed fps (tests, eval clips, demos without a tray)."""

    name = "file"

    def __init__(self, path: str, fps: float = 15) -> None:
        super().__init__()
        self.path, self.period = path, 1.0 / fps
        self._img: np.ndarray | None = None
        self._cap: cv2.VideoCapture | None = None

    def _open(self) -> None:
        self._img = cv2.imread(self.path)
        if self._img is None:
            self._cap = cv2.VideoCapture(self.path)
            if not self._cap.isOpened():
                raise RuntimeError(f"Cannot read {self.path}")

    def _grab(self) -> np.ndarray | None:
        time.sleep(self.period)
        if self._img is not None:
            return self._img.copy()
        ok, frame = self._cap.read()
        if not ok:  # loop the clip
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self._cap.read()
        return frame if ok else None

    def _close(self) -> None:
        if self._cap:
            self._cap.release()


def make_camera(devices: dict) -> CameraSource:
    import os

    override = os.getenv("STEPWISE_CAMERA", "")
    if override.startswith("file:"):
        return FileSource(override[5:], devices.get("fps", 15))
    kind = devices["camera"]
    if kind == "webcam":
        return LaptopWebcam(devices.get("webcam_index", 0), tuple(devices.get("frame_size", (640, 480))))
    if kind == "pi_stream":
        return PiStream(devices["pi_stream_url"])
    if kind == "file":
        return FileSource(devices["file_path"], devices.get("fps", 15))
    raise ValueError(f"unknown devices.camera {kind!r} (expected webcam | pi_stream | file)")
