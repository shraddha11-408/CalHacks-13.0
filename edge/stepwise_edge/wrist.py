"""Wrist node: Arduino Uno Q + touch sensor on USB serial.

Same protocol as hardware/backend/uno_serial_bridge.py and hardware/uno_q/wrist_node/wrist_node.ino:
  Uno -> laptop: DOWN (touch starts), UP (touch ends)
  laptop -> Uno: ACK (touch seen: one flash), BUZZ (help sent: CALL on the matrix for 2 s)
  hold >= 1.5 s -> "I'm stuck": help.   shorter -> "What now?": hear the step again.

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
    """Reads touches from the Uno Q and turns them into on_help / on_what_now calls."""

    def __init__(self, port: str | None = "auto", on_help=None, on_what_now=None, opener=_open_serial,
                 find=find_port, retry_s: float = 2.0, clock=time.monotonic):
        self.port = port
        self.on_help = on_help or (lambda: None)
        self.on_what_now = on_what_now or (lambda: None)
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
                action = self.on_help if held >= HOLD_FOR_HELP_S else self.on_what_now
                try:
                    action()
                except Exception:  # a bug in the app side must not drop the wrist connection
                    log.exception("wrist action failed")


class HelpRouter:
    """Turns wrist touches into coach actions for the session that is running.

    The worker's page does the actual help request (it adds a photo from the glasses). If no page
    answers within fallback_s, the server sends the help itself, so a press never goes nowhere.
    The Uno gets BUZZ (CALL) only once help has really been sent.
    """

    def __init__(self, sessions: dict, publish, send_help, fallback_s: float = 3.0, timer=threading.Timer):
        self.sessions, self.publish, self.send_help = sessions, publish, send_help
        self.fallback_s, self.timer = fallback_s, timer
        self.node: WristNode | None = None
        self._pending: set[str] = set()
        self._lock = threading.Lock()

    def active(self):
        """The most recently started session, or None. Copied in one step: the event loop may change it meanwhile."""
        current = list(self.sessions.values())
        return current[-1] if current else None

    def on_help(self) -> None:
        s = self.active()
        if s is None:
            log.warning("wrist: help pressed but no coaching session is running")
            self.publish("wrist", action="no_session")
            return
        already = s.flags.get(int(s.step["id"]), {}).get("help", 0) > 0
        self.publish("wrist", action="help", sid=s.id, already=already)
        if already:  # help is already on its way for this step: show CALL again, don't page twice
            self._buzz()
            return
        with self._lock:
            self._pending.add(s.id)
        self.timer(self.fallback_s, self._fallback, (s.id,)).start()

    def on_what_now(self) -> None:
        s = self.active()
        self.publish("wrist", action="what_now", sid=s.id if s else None)

    def help_sent(self, sid: str) -> None:
        """Called whenever a help request goes out (wrist, button or voice)."""
        with self._lock:
            self._pending.discard(sid)
        self.publish("help_sent", sid=sid)
        self._buzz()

    def _fallback(self, sid: str) -> None:
        with self._lock:
            if sid not in self._pending:
                return
            self._pending.discard(sid)
        if sid in self.sessions:
            log.info("wrist: no page answered; sending help from the server for %s", sid)
            self.send_help(sid)

    def _buzz(self) -> None:
        if self.node:
            self.node.send("BUZZ")
