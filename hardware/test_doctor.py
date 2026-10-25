"""Run: python3 -m unittest test_doctor   (from hardware/; uses a fake Pi on localhost)"""
import threading
import time
import unittest

import cv2
import numpy as np

import doctor
from audio_capture import RATE
from mjpeg_http import AudioHub, FrameBuffer, make_server


def fake_pi(video=True, audio=True):
    """A Pi stand-in on localhost: synthetic frames and a tone, paced in real time."""
    hub = AudioHub(RATE, 1) if audio else None
    buf = FrameBuffer()
    server = make_server(buf, host="127.0.0.1", port=0, audio=hub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stop = threading.Event()

    def produce_audio():
        n = 0
        t0 = time.monotonic()
        while not stop.is_set():
            hub.put((np.sin(np.arange(1600) / 10) * 9000).astype(np.int16).tobytes())
            n += 1
            time.sleep(max(0, t0 + n * 0.1 - time.monotonic()))

    def produce_video():
        ok, enc = cv2.imencode(".jpg", np.full((640, 480, 3), 80, np.uint8))
        n = 0
        t0 = time.monotonic()
        while not stop.is_set():
            buf.put(enc.tobytes())
            n += 1
            time.sleep(max(0, t0 + n / 15 - time.monotonic()))

    if hub:
        threading.Thread(target=produce_audio, daemon=True).start()
    if video:
        threading.Thread(target=produce_video, daemon=True).start()
    return server, stop, server.server_address[1]


class DoctorTest(unittest.TestCase):
    def test_everything_ok(self):
        server, stop, port = fake_pi()
        try:
            lines = []
            r = doctor.check(("127.0.0.1",), port=port, wait_s=5, say=lines.append, seconds=2)
        finally:
            stop.set(); server.shutdown()
        self.assertTrue(r["ok"], r["problems"])
        self.assertEqual(r["host"], "127.0.0.1")
        self.assertAlmostEqual(r["audio"]["realtime"], 1.0, delta=0.15)

    def test_unreachable_pi_gives_actionable_advice_quickly(self):
        t0 = time.monotonic()
        r = doctor.check(("127.0.0.1",), port=1, wait_s=0, say=lambda *_: None)
        self.assertFalse(r["ok"])
        self.assertIsNone(r["host"])
        self.assertIn("USB-C cable", r["problems"][0])
        self.assertLess(time.monotonic() - t0, 5)

    def test_missing_audio_is_reported_and_fails(self):
        server, stop, port = fake_pi(audio=False)
        try:
            r = doctor.check(("127.0.0.1",), port=port, wait_s=5, say=lambda *_: None, seconds=2)
        finally:
            stop.set(); server.shutdown()
        self.assertFalse(r["ok"])
        self.assertTrue(any("audio" in p.lower() for p in r["problems"]))

    def test_older_pi_without_status_gets_a_clear_message_not_a_traceback(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        class Old(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Old)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            r = doctor.check(("127.0.0.1",), port=server.server_address[1], wait_s=2, say=lambda *_: None)
        finally:
            server.shutdown()
        self.assertFalse(r["ok"])
        self.assertIn("deploy_to_pi.sh", r["problems"][0])

    def test_wait_for_pi_tries_the_next_host(self):
        server, stop, port = fake_pi()
        try:
            self.assertEqual(doctor.wait_for_pi(("203.0.113.1", "127.0.0.1"), port, 0), "127.0.0.1")
        finally:
            stop.set(); server.shutdown()


if __name__ == "__main__":
    unittest.main()
