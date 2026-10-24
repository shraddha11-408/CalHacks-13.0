"""Run: python3 -m unittest test_audio -v   (a synthetic 440 Hz tone stands in for the microphone)"""
import io
import socket
import threading
import time
import unittest
import urllib.error
import urllib.request

import numpy as np

import audio_capture
import audio_receiver
from mjpeg_http import AudioHub, FrameBuffer, make_server

RATE = 16000


def tone_chunk(n, freq=440.0, amp=0.3):
    t = (np.arange(n * 1600, (n + 1) * 1600)) / RATE
    return (amp * 32767 * np.sin(2 * np.pi * freq * t)).astype(np.int16).tobytes()


def start(audio=True):
    hub = AudioHub(RATE, 1) if audio else None
    server = make_server(FrameBuffer(), host="127.0.0.1", port=0, audio=hub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stop = threading.Event()
    if hub:
        def produce():
            n = 0
            t0 = time.monotonic()
            while not stop.is_set():
                hub.put(tone_chunk(n))
                n += 1
                time.sleep(max(0, t0 + n * 0.1 - time.monotonic()))
        threading.Thread(target=produce, daemon=True).start()
    return server, hub, stop, f"http://127.0.0.1:{server.server_address[1]}"


class HubTest(unittest.TestCase):
    def test_every_subscriber_gets_every_chunk(self):
        hub = AudioHub()
        a, b = hub.subscribe(), hub.subscribe()
        for i in range(5):
            hub.put(bytes([i]))
        self.assertEqual([a.get_nowait() for _ in range(5)], [bytes([i]) for i in range(5)])
        self.assertEqual([b.get_nowait() for _ in range(5)], [bytes([i]) for i in range(5)])

    def test_slow_subscriber_loses_oldest_not_newest(self):
        hub = AudioHub(max_chunks=3)
        q = hub.subscribe()
        for i in range(6):
            hub.put(bytes([i]))
        self.assertEqual([q.get_nowait() for _ in range(3)], [bytes([3]), bytes([4]), bytes([5])])

    def test_unsubscribed_queue_stops_receiving(self):
        hub = AudioHub()
        q = hub.subscribe()
        hub.unsubscribe(q)
        hub.put(b"x")
        self.assertTrue(q.empty())


class StatusTest(unittest.TestCase):
    def test_ages_are_none_until_data_arrives_then_small(self):
        hub, buf = AudioHub(), FrameBuffer()
        self.assertIsNone(hub.age())
        self.assertIsNone(buf.age())
        hub.put(b"x"); buf.put(b"y")
        self.assertLess(hub.age(), 1)
        self.assertLess(buf.age(), 1)

    def test_status_and_health_reflect_a_stalled_source(self):
        import json
        hub, buf = AudioHub(), FrameBuffer()
        server = make_server(buf, host="127.0.0.1", port=0, audio=hub)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            self.assertEqual(urllib.request.urlopen(base + "/health").read(), b"no frames")
            self.assertIsNone(json.load(urllib.request.urlopen(base + "/status"))["video_age_s"])
            buf.put(b"frame")
            self.assertEqual(urllib.request.urlopen(base + "/health").read(), b"ok")
            st = json.load(urllib.request.urlopen(base + "/status"))
            self.assertTrue(st["audio_enabled"])
            self.assertIsNone(st["audio_age_s"])
            time.sleep(3.2)  # the camera stops sending: health must not stay "ok"
            self.assertEqual(urllib.request.urlopen(base + "/health").read(), b"no frames")
        finally:
            server.shutdown()


class CaptureTest(unittest.TestCase):
    def test_pump_cuts_fixed_chunks_and_drops_the_partial_tail(self):
        hub = AudioHub()
        q = hub.subscribe()
        audio_capture.pump(io.BytesIO(b"a" * 3200 + b"b" * 3200 + b"c" * 100), hub)
        self.assertEqual([q.get_nowait() for _ in range(2)], [b"a" * 3200, b"b" * 3200])
        self.assertTrue(q.empty())

    def test_arecord_command_matches_the_measured_device_format(self):
        cmd = audio_capture.arecord_cmd("B100")
        self.assertIn("hw:CARD=B100,DEV=0", cmd)
        self.assertEqual(cmd[cmd.index("-f") + 1], "S16_LE")
        self.assertEqual(cmd[cmd.index("-r") + 1], "16000")
        self.assertEqual(cmd[cmd.index("-c") + 1], "1")


class StreamTest(unittest.TestCase):
    def test_stream_is_realtime_and_carries_the_tone(self):
        server, hub, stop, base = start()
        try:
            s = audio_receiver.run(base + "/audio", seconds=3, save=None)
        finally:
            stop.set(); server.shutdown()
        self.assertAlmostEqual(s["realtime"], 1.0, delta=0.15)
        self.assertFalse(s["clipping"])
        self.assertAlmostEqual(s["loudest_dbfs"], -13.5, delta=1.5)  # 0.3 amplitude sine: -10.5 - 3 dB rms

    def test_received_tone_has_the_right_frequency(self):
        server, hub, stop, base = start()
        try:
            pcm = np.concatenate([c for c, _ in zip((p for p, _ in audio_receiver.iter_pcm(base + "/audio")), range(10))])
        finally:
            stop.set(); server.shutdown()
        spec = np.abs(np.fft.rfft(pcm.astype(np.float64)))
        peak_hz = np.argmax(spec) * RATE / len(pcm)
        self.assertAlmostEqual(peak_hz, 440, delta=10)

    def test_stalled_client_does_not_block_a_healthy_one(self):
        server, hub, stop, base = start()
        try:
            host, port = base.replace("http://", "").split(":")
            stalled = socket.create_connection((host, int(port)))
            stalled.sendall(b"GET /audio HTTP/1.1\r\nHost: x\r\n\r\n")  # never reads
            time.sleep(0.3)
            s = audio_receiver.run(base + "/audio", seconds=3)
            stalled.close()
        finally:
            stop.set(); server.shutdown()
        self.assertAlmostEqual(s["realtime"], 1.0, delta=0.15)

    def test_audio_is_404_when_disabled(self):
        server, hub, stop, base = start(audio=False)
        try:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(base + "/audio")
            self.assertEqual(cm.exception.code, 404)
        finally:
            server.shutdown()


if __name__ == "__main__":
    unittest.main()
