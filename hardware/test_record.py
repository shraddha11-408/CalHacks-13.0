"""Run: python3 -m unittest test_record   (from hardware/; needs ffmpeg and ffprobe)"""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import record
from test_doctor import fake_pi


class CommandTest(unittest.TestCase):
    def cmd(self, **kw):
        return record.build_cmd("h", "out.mp4", **kw)

    def test_only_the_video_input_uses_wallclock_timestamps(self):
        c = self.cmd()
        self.assertEqual(c.count("-use_wallclock_as_timestamps"), 1)
        self.assertLess(c.index("-use_wallclock_as_timestamps"), c.index("http://h:8000/stream"))
        self.assertGreater(c.index("http://h:8000/audio"), c.index("http://h:8000/stream"))

    def test_audio_is_delayed_by_the_measured_offset(self):
        c = self.cmd()
        self.assertEqual(c[c.index("-itsoffset") + 1], "0.28")
        self.assertLess(c.index("-itsoffset"), c.index("http://h:8000/audio"))
        self.assertEqual(self.cmd(av_offset=0.1)[self.cmd(av_offset=0.1).index("-itsoffset") + 1], "0.1")

    def test_audio_input_is_raw_16k_mono(self):
        c = self.cmd()
        i = c.index("http://h:8000/audio")
        self.assertEqual(c[i - 7:i], ["-f", "s16le", "-ar", "16000", "-ac", "1", "-i"])

    def test_no_audio_drops_the_audio_input(self):
        c = self.cmd(audio=False)
        self.assertNotIn("http://h:8000/audio", c)
        self.assertIn("-an", c)

    def test_duration_limit(self):
        c = self.cmd(seconds=7)
        self.assertEqual(c[c.index("-t") + 1], "7")
        self.assertNotIn("-t", self.cmd())


class SidecarTest(unittest.TestCase):
    def test_sidecar_next_to_the_clip(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "a.mp4"
            record.write_sidecar(out, "h", "wrong_slot", "s3", "2026-10-24T12:00:00", 20.0, 0.23, True)
            meta = json.loads((Path(d) / "a.json").read_text())
        self.assertEqual((meta["label"], meta["step"], meta["av_offset_s"]), ("wrong_slot", "s3", 0.23))


class RecordTest(unittest.TestCase):
    def test_records_one_file_with_both_streams_at_real_speed(self):
        server, stop, port = fake_pi()
        try:
            with tempfile.TemporaryDirectory() as d:
                out = Path(d) / "r.mp4"
                subprocess.run(record.build_cmd("127.0.0.1", out, seconds=4, port=port), check=True,
                               stderr=subprocess.DEVNULL)
                p = record.probe(out)
                n = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_packets", "-show_entries",
                                    "stream=nb_read_packets", "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout
        finally:
            stop.set(); server.shutdown()
        self.assertIsNotNone(p["video"])
        self.assertIsNotNone(p["audio"])
        self.assertAlmostEqual(p["video"], 4, delta=0.7)
        self.assertAlmostEqual(p["audio"], 4, delta=0.7)
        self.assertAlmostEqual(int(n) / p["video"], 15, delta=3)  # 15 fps, not the 25 fps ffmpeg assumes


if __name__ == "__main__":
    unittest.main()
