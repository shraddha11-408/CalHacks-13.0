"""Run: python3 -m unittest test_stream -v   (needs opencv-python; no Pi required)"""
import unittest
import urllib.request

import receiver
import touch_monitor
from fake_server import start_fake


class StreamTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server, cls.stop = start_fake(fps=15)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.stop.set()
        cls.server.shutdown()

    def test_health_and_snapshot(self):
        import time; time.sleep(0.3)
        self.assertEqual(urllib.request.urlopen(self.base + "/health").read(), b"ok")
        img = receiver.decode(urllib.request.urlopen(self.base + "/snapshot.jpg").read())
        self.assertEqual(img.shape, (480, 640, 3))

    def test_stream_decodes_at_target_fps(self):
        s = receiver.run(self.base + "/stream", max_frames=45)
        self.assertEqual(s["frames"], 45)
        self.assertEqual(s["shape"], (480, 640, 3))
        self.assertAlmostEqual(s["fps"], 15, delta=3)

    def test_multiple_clients(self):
        import threading
        out = []
        ts = [threading.Thread(target=lambda: out.append(receiver.run(self.base + "/stream", max_frames=20))) for _ in range(3)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual([o["frames"] for o in out], [20, 20, 20])

    def test_unknown_path_404(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.base + "/nope")
        self.assertEqual(cm.exception.code, 404)

    def test_touch_state_and_events(self):
        t = self.server.touch
        start = touch_monitor.get_json(self.base + "/touch")
        self.assertFalse(start["pressed"])
        t.set(True)
        t.set(True)  # repeated state is not a new event
        t.set(False)
        r = touch_monitor.get_json(f"{self.base}/touch/events?since={start['seq']}&timeout=1")
        self.assertEqual([e["type"] for e in r["events"]], ["down", "up"])
        end = touch_monitor.get_json(self.base + "/touch")
        self.assertEqual(end["count"], start["count"] + 1)

    def test_touch_longpoll_wakes_on_event(self):
        import threading, time
        since = touch_monitor.get_json(self.base + "/touch")["seq"]
        threading.Timer(0.3, lambda: self.server.touch.set(True)).start()
        t0 = time.monotonic()
        r = touch_monitor.get_json(f"{self.base}/touch/events?since={since}&timeout=5")
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertEqual(r["events"][0]["type"], "down")
        self.server.touch.set(False)

    def test_touch_longpoll_times_out_empty(self):
        since = touch_monitor.get_json(self.base + "/touch")["seq"]
        r = touch_monitor.get_json(f"{self.base}/touch/events?since={since}&timeout=0.3")
        self.assertEqual(r["events"], [])


if __name__ == "__main__":
    unittest.main()
