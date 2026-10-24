"""Stdlib-only MJPEG-over-HTTP server shared by the Pi streamer and the test server."""
import json
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BOUNDARY = "frame"


class FrameBuffer:
    """Holds the newest JPEG. Slow clients skip frames instead of queueing them."""

    def __init__(self):
        self._cond = threading.Condition()
        self._frame = None
        self._seq = 0

    def put(self, jpeg: bytes):
        with self._cond:
            self._frame = jpeg
            self._seq += 1
            self._cond.notify_all()

    def latest(self):
        with self._cond:
            return self._frame

    def wait_next(self, last_seq: int, timeout: float = 2.0):
        with self._cond:
            if not self._cond.wait_for(lambda: self._seq != last_seq, timeout):
                return None, last_seq
            return self._frame, self._seq


class TouchState:
    """Touch sensor state plus a short event log, readable by long-poll."""

    def __init__(self, keep: int = 200):
        self._cond = threading.Condition()
        self._events = []  # (seq, "down" | "up", unix_ts)
        self._seq = 0
        self._count = 0
        self._pressed = False
        self._keep = keep

    def set(self, pressed: bool):
        with self._cond:
            if pressed == self._pressed:
                return
            self._pressed = pressed
            self._seq += 1
            if pressed:
                self._count += 1
            self._events.append((self._seq, "down" if pressed else "up", time.time()))
            del self._events[: -self._keep]
            self._cond.notify_all()

    def snapshot(self):
        with self._cond:
            return {"pressed": self._pressed, "count": self._count, "seq": self._seq}

    def wait(self, since: int, timeout: float = 10.0):
        """Events with seq > since; blocks up to timeout if there are none yet."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq > since, timeout)
            return {
                "seq": self._seq,
                "events": [{"seq": q, "type": t, "ts": ts} for q, t, ts in self._events if q > since],
            }


def make_server(buffer: FrameBuffer, host: str = "0.0.0.0", port: int = 8000, touch: TouchState = None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def _send(self, code, ctype, body):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj):
            self._send(200, "application/json", json.dumps(obj).encode())

        def do_GET(self):
            url = urlparse(self.path)
            if url.path in ("/touch", "/touch/events"):
                if touch is None:
                    self._send(404, "text/plain", b"touch sensor not enabled")
                elif url.path == "/touch":
                    self._json(touch.snapshot())
                else:
                    q = parse_qs(url.query)
                    since = int(q.get("since", ["0"])[0])
                    timeout = min(float(q.get("timeout", ["10"])[0]), 30.0)
                    self._json(touch.wait(since, timeout))
                return
            if self.path == "/health":
                self._send(200, "text/plain", b"ok" if buffer.latest() else b"no frames")
            elif self.path == "/snapshot.jpg":
                jpeg = buffer.latest()
                if jpeg is None:
                    self._send(503, "text/plain", b"no frames yet")
                else:
                    self._send(200, "image/jpeg", jpeg)
            elif self.path == "/stream":
                self.send_response(200)
                self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                seq = 0
                try:
                    while True:
                        jpeg, seq = buffer.wait_next(seq)
                        if jpeg is None:
                            continue
                        self.wfile.write(
                            f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                            f"Content-Length: {len(jpeg)}\r\n\r\n".encode()
                        )
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self._send(404, "text/plain", b"not found")

    class Server(ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            if isinstance(sys.exc_info()[1], ConnectionError):
                return  # client went away; not an error
            super().handle_error(request, client_address)

    server = Server((host, port), Handler)
    server.daemon_threads = True
    return server
