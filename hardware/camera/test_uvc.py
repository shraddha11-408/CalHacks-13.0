"""Run: python3 -m unittest test_uvc -v   (uses ffmpeg's test pattern in place of a webcam)"""
import io
import subprocess
import threading
import unittest

import receiver
import uvc_streamer
from mjpeg_http import FrameBuffer, make_server


def test_pattern_cmd(fps=15, size="640x480", rotate=0):
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi",
            "-i", f"testsrc=size={size}:rate={fps}"] + uvc_streamer.output_args(True, rotate)


class SplitterTest(unittest.TestCase):
    JPEG = lambda n: b"\xff\xd8\xff\xe0" + bytes([n]) * 50 + b"\xff\x00\xff\xd9"

    def test_splits_back_to_back_frames(self):
        a, b = SplitterTest.JPEG(1), SplitterTest.JPEG(2)
        self.assertEqual(list(uvc_streamer.jpeg_frames(io.BytesIO(a + b + a))), [a, b, a])

    def test_frames_split_across_reads(self):
        a, b = SplitterTest.JPEG(1), SplitterTest.JPEG(2)
        data = a + b
        for chunk in (1, 3, 7, 1000):
            with self.subTest(chunk=chunk):
                self.assertEqual(list(uvc_streamer.jpeg_frames(io.BytesIO(data), chunk=chunk)), [a, b])

    def test_garbage_and_truncated_tail_are_dropped(self):
        a = SplitterTest.JPEG(1)
        data = b"junk" + a + SplitterTest.JPEG(2)[:-5]
        self.assertEqual(list(uvc_streamer.jpeg_frames(io.BytesIO(data))), [a])

    def test_frame_is_delivered_as_soon_as_it_arrives(self):
        a = SplitterTest.JPEG(1)

        class OneShot:
            reads = 0

            def read1(self, n):
                OneShot.reads += 1
                if OneShot.reads > 1:
                    raise AssertionError("asked for more data before yielding the finished frame")
                return a

        self.assertEqual(next(uvc_streamer.jpeg_frames(OneShot())), a)

    def test_rotation_filters_and_reencode(self):
        for deg, vf in ((90, "transpose=1"), (180, "hflip,vflip"), (270, "transpose=2")):
            with self.subTest(deg=deg):
                cmd = uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, False, rotate=deg)
                self.assertEqual(cmd[cmd.index("-vf") + 1], vf)
                self.assertNotIn("copy", cmd)
                self.assertIn("-input_format", cmd)  # still reads the camera's MJPEG
        self.assertNotIn("-vf", uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, False, rotate=0))

    def test_command_flushes_every_packet(self):
        cmd = uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, False)
        self.assertEqual(cmd[cmd.index("-flush_packets") + 1], "1")

    def test_command_uses_mjpeg_copy_unless_reencoding(self):
        self.assertIn("copy", uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, False))
        self.assertIn("-input_format", uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, False))
        re = uvc_streamer.ffmpeg_cmd("/dev/video0", 640, 480, 15, True)
        self.assertNotIn("copy", re)
        self.assertNotIn("-input_format", re)


class EndToEndTest(unittest.TestCase):
    def test_ffmpeg_frames_reach_the_receiver(self):
        self._run(0, (480, 640, 3))

    def test_rotated_frames_have_swapped_dimensions(self):
        self._run(90, (640, 480, 3))
        self._run(270, (640, 480, 3))

    def test_upside_down_keeps_dimensions(self):
        self._run(180, (480, 640, 3))

    def _run(self, rotate, shape):
        buffer = FrameBuffer()
        server = make_server(buffer, host="127.0.0.1", port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        threading.Thread(target=uvc_streamer.pump, args=(test_pattern_cmd(rotate=rotate), buffer), daemon=True).start()
        try:
            s = receiver.run(f"http://127.0.0.1:{server.server_address[1]}/stream", max_frames=45)
        finally:
            server.shutdown()
        self.assertEqual(s["frames"], 45)
        self.assertEqual(s["shape"], shape)
        self.assertAlmostEqual(s["fps"], 15, delta=2)  # frames must not be dropped in bursts


if __name__ == "__main__":
    unittest.main()
