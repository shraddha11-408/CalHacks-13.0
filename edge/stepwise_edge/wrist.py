"""Wrist node: Arduino Uno Q + touch sensor on USB serial.

Same protocol as hardware/backend/uno_serial_bridge.py and hardware/uno_q/wrist_node/wrist_node.ino:
  Uno -> laptop: DOWN (touch starts), UP (touch ends)
  laptop -> Uno: ACK (touch seen: one flash), BUZZ (supervisor called: CALL on the matrix for 2 s),
                 NOTE (note sent: a check mark for 1.5 s)
  hold >= 1.5 s -> call the supervisor now (rings their screen).   shorter -> a quiet note to the supervisor.

Both go through the same code as POST /wrist/press (api.wrist_press), with the newest face-blurred live frame.
The port is found by itself (Arduino USB vendor id 0x2341), so the same config works whether
the board shows up as COM5, /dev/cu.usbmodem..., or /dev/ttyACM0. Set devices.wrist_port to
force one. Unplugged or missing board: retry quietly every 2 s; the app keeps running.
"""
from __future__ import annotations

import glob
import logging
import threading
import time

log = logging.getLogger("stepwise.wrist")

HOLD_FOR_HELP_S = 1.5
ARDUINO_VID = 0x2341
PATTERNS = ("/dev/cu.usbmodem*", "/dev/ttyACM*")


def find_port(configured: str | None = "auto", list_ports=None, globber=glob.glob) -> str | None:
    """A configured port wins; else the first Arduino by USB vendor id; else the first USB modem device."""
    if configured and configured != "auto":
        return configured
    if list_ports is None:
        try:
            from serial.tools import list_ports as lp

            list_ports = lp.comports
        except ImportError:
            list_ports = list
    for p in sorted(list_ports(), key=lambda p: p.device):
        if getattr(p, "vid", None) == ARDUINO_VID:
            return p.device
    for pattern in PATTERNS:
        matches = sorted(globber(pattern))
        if matches:
            return matches[0]
    return None


def _open_serial(port: str):
    import serial  # pyserial

    return serial.Serial(port, 115200, timeout=0.1)


class WristNode:
    """Reads touches from the Uno Q and turns them into on_hold (>= 1.5 s) / on_touch (shorter) calls."""

    def __init__(self, port: str | None = "auto", on_hold=None, on_touch=None, opener=_open_serial,
                 find=find_port, retry_s: float = 2.0, clock=time.monotonic):
        self.port = port
        self.on_hold = on_hold or (lambda: None)
        self.on_touch = on_touch or (lambda: None)
        self.opener, self.find, self.retry_s, self.clock = opener, find, retry_s, clock
        self.status = "off"
        self._ser = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> "WristNode":
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="wrist", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self.status = "off"

    def send(self, cmd: str) -> bool:
        """Write one command line to the Uno. False if it is not connected."""
        with self._lock:
            if self._ser is None:
                return False
            try:
                self._ser.write(f"{cmd}\n".encode())
                return True
            except Exception as e:  # unplugged mid-write: the read loop notices and reconnects
                log.warning("wrist write failed: %s", e)
                return False

    def _run(self) -> None:
        while not self._stop.is_set():
            port = self.find(self.port)
            if not port:
                self.status = "no Uno Q found; plug it in"
                self._stop.wait(self.retry_s)
                continue
            try:
                with self.opener(port) as ser:
                    with self._lock:
                        self._ser = ser
                    self.status = f"connected on {port}"
                    log.info("wrist node connected on %s", port)
                    self._read(ser)
            except ImportError:
                self.status = "pyserial not installed (pip install pyserial)"
                return
            except Exception as e:
                self.status = f"not connected on {port} ({type(e).__name__}); retrying"
            finally:
                with self._lock:
                    self._ser = None
            self._stop.wait(self.retry_s)

    def _read(self, ser) -> None:
        pressed_at = None
        while not self._stop.is_set():
            line = ser.readline().decode(errors="replace").strip()
            if line == "DOWN":
                pressed_at = self.clock()
                self.send("ACK")
            elif line == "UP" and pressed_at is not None:
                held, pressed_at = self.clock() - pressed_at, None
                action = self.on_hold if held >= HOLD_FOR_HELP_S else self.on_touch
                try:
                    action()
                except Exception:  # a bug in the app side must not drop the wrist connection
                    log.exception("wrist action failed")


class HelpRouter:
    """Turns wrist touches into supervisor calls and notes for the session that is running.

    press(kind, sid) starts api.wrist_press on the event loop and returns a concurrent Future of its reply.
    The Uno gets BUZZ (CALL) only once a call has really gone out (help_sent). The worker's page gets a "wrist" event
    with what to say ("Okay. I'm calling your supervisor now.").
    """

    def __init__(self, sessions: dict, publish, press):
        self.sessions, self.publish, self.press = sessions, publish, press
        self.node: WristNode | None = None

    def active(self):
        """The most recently started session, or None. Copied in one step: the event loop may change it meanwhile."""
        current = list(self.sessions.values())
        return current[-1] if current else None

    def on_hold(self) -> None:
        self._send("call")

    def on_touch(self) -> None:
        self._send("notify")

    def help_sent(self, sid: str) -> None:
        """Help sent another way (the page's button or voice): show CALL too."""
        self.publish("help_sent", sid=sid)
        self._buzz()

    def _send(self, kind: str) -> None:
        s = self.active()
        if s is None:
            log.warning("wrist: %s with no coaching session running; nobody to send it for", kind)
            self.publish("wrist", action="no_session", kind=kind)
            return
        self.press(kind, s.id).add_done_callback(lambda f: self._sent(kind, s.id, f))

    def _sent(self, kind: str, sid: str, fut) -> None:
        try:
            r = fut.result()
        except Exception as e:
            log.warning("wrist %s failed: %s", kind, e)
            return
        if not r.get("ok"):
            log.warning("wrist %s not sent: %s", kind, r.get("error"))
            return
        # CALL on the matrix comes from help_sent (api.wrist_press runs HELP_SENT_HOOKS for a call)
        if kind == "notify" and self.node:
            self.node.send("NOTE")
        self.publish("wrist", action=kind, sid=sid, say=r.get("say", []), duplicate=r.get("duplicate", False))

    def _buzz(self) -> None:
        if self.node:
            self.node.send("BUZZ")
