"""Test stand-in for the Pi: serves synthetic frames through the same MJPEG server.  python3 fake_server.py [--port 8000]"""
import argparse
import threading
import time

import cv2
import numpy as np

from mjpeg_http import FrameBuffer, TouchState, make_server


def start_fake(port=0, fps=15, w=640, h=480):
    """Start in background; returns (server, stop_event). port=0 picks a free port.
    server.touch is a TouchState tests can drive with .set(True/False)."""
    buffer = FrameBuffer()
    touch = TouchState()
    server = make_server(buffer, host="127.0.0.1", port=port, touch=touch)
    server.touch = touch
    stop = threading.Event()

    def produce():
        n = 0
        while not stop.is_set():
            img = np.full((h, w, 3), 40, np.uint8)
            cv2.putText(img, f"frame {n}", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
            ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
            buffer.put(enc.tobytes())
            n += 1
            time.sleep(1 / fps)

    threading.Thread(target=produce, daemon=True).start()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, stop


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--fps", type=int, default=15)
    a = ap.parse_args()
    srv, _ = start_fake(a.port, a.fps)
    print(f"fake stream on http://127.0.0.1:{srv.server_address[1]}/stream")
    threading.Event().wait()
