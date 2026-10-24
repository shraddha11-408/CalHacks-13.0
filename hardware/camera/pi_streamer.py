"""Runs on the Pi 5: Picamera2 -> MJPEG over HTTP.  Usage: python3 pi_streamer.py [--port 8000]"""
import argparse
import io

from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

from mjpeg_http import FrameBuffer, make_server


class BufferOutput(io.BufferedIOBase):
    """Picamera2 writes one complete JPEG per write() call."""

    def __init__(self, buffer: FrameBuffer):
        self.buffer = buffer

    def write(self, data):
        self.buffer.put(bytes(data))
        return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--bitrate", type=int, default=8_000_000)
    args = ap.parse_args()

    cam = Picamera2()
    cam.configure(cam.create_video_configuration(
        main={"size": (args.width, args.height)},
        controls={"FrameRate": args.fps},
    ))
    buffer = FrameBuffer()
    cam.start_recording(MJPEGEncoder(bitrate=args.bitrate), FileOutput(BufferOutput(buffer)))
    server = make_server(buffer, port=args.port)
    print(f"Streaming {args.width}x{args.height}@{args.fps} on http://0.0.0.0:{args.port}/stream")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        cam.stop_recording()


if __name__ == "__main__":
    main()
