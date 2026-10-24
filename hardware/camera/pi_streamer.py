"""Runs on the Pi 5: Picamera2 -> MJPEG over HTTP.  Usage: python3 pi_streamer.py [--port 8000]"""
import argparse
import io

from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

from mjpeg_http import FrameBuffer, TouchState, make_server


class BufferOutput(io.BufferedIOBase):
    """Picamera2 writes one complete JPEG per write() call."""

    def __init__(self, buffer: FrameBuffer):
        self.buffer = buffer

    def write(self, data):
        self.buffer.put(bytes(data))
        return len(data)


def start_touch(pin: int, active_high: bool, touch: TouchState):
    """Mirror a GPIO touch sensor into `touch`. Returns the gpiozero device (keep a reference)."""
    from gpiozero import DigitalInputDevice

    dev = DigitalInputDevice(pin, pull_up=None, active_state=active_high, bounce_time=0.03)
    touch.set(dev.is_active)
    dev.when_activated = lambda: touch.set(True)
    dev.when_deactivated = lambda: touch.set(False)
    return dev


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--bitrate", type=int, default=8_000_000)
    ap.add_argument("--touch-pin", type=int, default=14, help="BCM pin of the touch sensor; 0 disables")
    ap.add_argument("--touch-active-low", action="store_true", help="sensor pulls the pin LOW when touched")
    args = ap.parse_args()

    cam = Picamera2()
    cam.configure(cam.create_video_configuration(
        main={"size": (args.width, args.height)},
        controls={"FrameRate": args.fps},
    ))
    buffer = FrameBuffer()
    cam.start_recording(MJPEGEncoder(bitrate=args.bitrate), FileOutput(BufferOutput(buffer)))
    touch = TouchState() if args.touch_pin else None
    touch_dev = start_touch(args.touch_pin, not args.touch_active_low, touch) if touch else None  # noqa: F841
    server = make_server(buffer, port=args.port, touch=touch)
    print(f"Streaming {args.width}x{args.height}@{args.fps} on http://0.0.0.0:{args.port}/stream"
          + (f", touch on GPIO{args.touch_pin}" if touch else ""))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        cam.stop_recording()


if __name__ == "__main__":
    main()
