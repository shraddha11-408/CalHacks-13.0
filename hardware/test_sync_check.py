"""Run: python3 -m unittest test_sync_check   (builds a synthetic clip with ffmpeg)"""
import subprocess
import tempfile
import unittest
from pathlib import Path

import sync_check


def make_clip(path, video_flashes, audio_beeps):
    flash = "+".join(f"between(t,{t},{t + 0.06})" for t in video_flashes)
    beep = "+".join(f"between(t,{t},{t + 0.05})" for t in audio_beeps)
    subprocess.run(["ffmpeg", "-v", "error", "-y",
                    "-f", "lavfi", "-i", f"color=black:s=160x120:r=30:d=5,drawbox=x=0:y=0:w=160:h=120:color=white:t=fill:enable='{flash}'",
                    "-f", "lavfi", "-i", f"aevalsrc='0.8*sin(2*PI*1000*t)*({beep})':s=16000:d=5",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True)


class SyncTest(unittest.TestCase):
    def check(self, lag):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.mp4"
            make_clip(p, [1.0 + lag, 2.2 + lag, 3.4 + lag], [1.0, 2.2, 3.4])
            return sync_check.offsets(p)

    def test_recovers_a_late_picture(self):
        for lag in (0.2, 0.3):
            with self.subTest(lag=lag):
                for x in self.check(lag):
                    self.assertAlmostEqual(x, lag, delta=0.08)

    def test_in_sync_is_near_zero(self):
        for x in self.check(0.0):
            self.assertAlmostEqual(x, 0.0, delta=0.08)

    def test_early_picture_is_negative(self):
        for x in self.check(-0.2):
            self.assertAlmostEqual(x, -0.2, delta=0.08)


if __name__ == "__main__":
    unittest.main()
