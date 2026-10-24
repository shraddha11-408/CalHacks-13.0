"""Stdlib-only MJPEG-over-HTTP server shared by the Pi streamer and the test server."""
import json
import queue
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BOUNDARY = "frame"


class FrameBuffer:
    """Holds the newest JPEG. Slow clients skip frames instead of queueing them."""

    def __init__(self):
        self._cond = threading.Condition()
        self._frame = None
        self._seq = 0
        self._t = None

    def put(self, jpeg: bytes):
        with self._cond:
            self._frame = jpeg
            self._seq += 1
            self._t = time.monotonic()
            self._cond.notify_all()

    def latest(self):
        with self._cond:
            return self._frame

    def age(self):
        """Seconds since the last frame, or None if none has arrived."""
        with self._cond:
            return None if self._t is None else time.monotonic() - self._t

    def wait_next(self, last_seq: int, timeout: float = 2.0):
        with self._cond:
            if not self._cond.wait_for(lambda: self._seq != last_seq, timeout):
                return None, last_seq
            return self._frame, self._seq


class AudioHub:
    """Fan-out for raw PCM. Unlike video, every client needs every chunk, so each gets its own
    queue; a client that falls behind loses its oldest chunks instead of stalling the others."""

    def __init__(self, rate: int = 16000, channels: int = 1, max_chunks: int = 100):
        self.rate, self.channels, self.max_chunks = rate, channels, max_chunks
        self._lock = threading.Lock()
        self._subs = []
        self._t = None

    def age(self):
        """Seconds since the last chunk, or None if none has arrived."""
        return None if self._t is None else time.monotonic() - self._t

    def subscribe(self):
        q = queue.Queue(self.max_chunks)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def put(self, chunk: bytes):
        self._t = time.monotonic()
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(chunk)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(chunk)
                except (queue.Empty, queue.Full):
                    pass


def make_server(buffer: FrameBuffer, host: str = "0.0.0.0", port: int = 8000, audio: AudioHub = None):
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

        def do_GET(self):
            if self.path == "/health":
                age = buffer.age()
                self._send(200, "text/plain", b"ok" if age is not None and age < 3 else b"no frames")
            elif self.path == "/status":
                body = {"video_age_s": buffer.age(), "audio_enabled": audio is not None,
                        "audio_age_s": audio.age() if audio else None}
                self._send(200, "application/json", json.dumps(body).encode())
            elif self.path == "/snapshot.jpg":
                jpeg = buffer.latest()
                if jpeg is None:
                    self._send(503, "text/plain", b"no frames yet")
                else:
                    self._send(200, "image/jpeg", jpeg)
            elif self.path == "/audio":
                if audio is None:
                    self._send(404, "text/plain", b"audio not enabled")
                    return
                self.send_response(200)
                self.send_header("Content-Type", f"audio/L16; rate={audio.rate}; channels={audio.channels}")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                q = audio.subscribe()
                try:
                    while True:
                        try:
                            chunk = q.get(timeout=2.0)
                        except queue.Empty:
                            continue
                        self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    audio.unsubscribe(q)
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
