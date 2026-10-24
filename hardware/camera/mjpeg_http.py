"""Stdlib-only MJPEG-over-HTTP server shared by the Pi streamer and the test server."""
import sys
import threading
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


def make_server(buffer: FrameBuffer, host: str = "0.0.0.0", port: int = 8000):
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
