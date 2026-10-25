"""Runs on the Pi 5: USB (UVC) webcam -> MJPEG over HTTP, endpoints /stream, /snapshot.jpg and /health.

Most UVC webcams (including the Logitech Brio 100) can output MJPEG themselves, so ffmpeg just
copies the camera's JPEG frames and nothing is re-encoded on the Pi.

  python3 uvc_streamer.py                       # /dev/video0, 640x480 at 15 fps
  python3 uvc_streamer.py --device /dev/video2  # pick another node (v4l2-ctl --list-devices)
  python3 uvc_streamer.py --reencode            # camera has no MJPEG at that size: re-encode on the Pi
  python3 uvc_streamer.py --rotate 180          # rotate clockwise 90/180/270 (decodes and re-encodes)
"""
import argparse
import atexit
import signal
import subprocess
import sys
import threading
import time

import audio_capture
from mjpeg_http import AudioHub, FrameBuffer, make_server

SOI, EOI = b"\xff\xd8\xff", b"\xff\xd9"


def jpeg_frames(stream, chunk: int = 65536):
    """Yield complete JPEGs from a byte stream of back-to-back JPEG files (ffmpeg `-f mjpeg`).

    Entropy-coded JPEG data never contains the 0xFFD9 end marker (0xFF is escaped as 0xFF00),
    and webcam frames carry no embedded thumbnails, so the first EOI after an SOI ends the frame.
    """
    # read1 returns whatever has arrived. read(n) would wait for n bytes, so two frames would
    # land together and the server (newest frame only) would drop one of them.
    read = stream.read1 if hasattr(stream, "read1") else stream.read
    buf = b""
    while True:
        data = read(chunk)
        if not data:
            return
        buf += data
        while True:
            start = buf.find(SOI)
            if start < 0:
                buf = buf[-2:]  # keep a possible partial marker
                break
            end = buf.find(EOI, start + 3)
            if end < 0:
                buf = buf[start:]
                break
            yield buf[start:end + 2]
            buf = buf[end + 2:]


ROTATE_FILTER = {0: None, 90: "transpose=1", 180: "hflip,vflip", 270: "transpose=2"}  # clockwise degrees


def output_args(transcode: bool, rotate: int = 0, quality: int = 5):
    """ffmpeg output side. Copying the camera's JPEGs is free; rotating needs a decode and re-encode."""
    vf = ROTATE_FILTER[rotate]
    args = ["-vf", vf] if vf else []
    args += ["-c:v", "mjpeg", "-q:v", str(quality)] if (transcode or vf) else ["-c:v", "copy"]
    return args + ["-flush_packets", "1", "-f", "mjpeg", "-"]


def ffmpeg_cmd(device: str, width: int, height: int, fps: int, reencode: bool, quality: int = 5, rotate: int = 0):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "v4l2"]
    if not reencode:
        cmd += ["-input_format", "mjpeg"]
    cmd += ["-video_size", f"{width}x{height}", "-framerate", str(fps), "-i", device]
    return cmd + output_args(reencode, rotate, quality)


_procs = []


@atexit.register
def _kill_children():
    for p in _procs:
        p.kill()


def pump(cmd, buffer: FrameBuffer):
    """Run ffmpeg and push every JPEG into `buffer`; returns ffmpeg's exit code."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    _procs.append(proc)
    try:
        for jpeg in jpeg_frames(proc.stdout):
            buffer.put(jpeg)
    finally:
        proc.kill()
    return proc.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="/dev/video0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--reencode", action="store_true")
    ap.add_argument("--no-audio", action="store_true", help="do not serve the webcam microphone at /audio")
    ap.add_argument("--gain", type=int, default=3072, help="mic capture volume 0..6144; the default 6144 clips")
    ap.add_argument("--rotate", type=int, choices=sorted(ROTATE_FILTER), default=0, help="degrees clockwise")
    args = ap.parse_args()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # run atexit so ffmpeg does not outlive us
    buffer = FrameBuffer()
    cmd = ffmpeg_cmd(args.device, args.width, args.height, args.fps, args.reencode, rotate=args.rotate)

    def run():
        """Restart ffmpeg whenever the webcam goes away (unplugged, USB reset) and comes back."""
        while True:
            code = pump(cmd, buffer)
            print(f"video source stopped (ffmpeg exit {code}); is {args.device} plugged in and does it do "
                  f"MJPEG {args.width}x{args.height}? retrying in 2 s", flush=True)
            time.sleep(2)

    threading.Thread(target=run, daemon=True).start()
    hub = None
    if not args.no_audio:
        hub = AudioHub(audio_capture.RATE, audio_capture.CHANNELS)
        threading.Thread(target=audio_capture.run_forever, args=(hub, args.gain), daemon=True).start()
    server = make_server(buffer, port=args.port, audio=hub)
    print(f"Streaming {args.device} {args.width}x{args.height}@{args.fps} rotate={args.rotate} on http://0.0.0.0:{args.port}/stream", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
