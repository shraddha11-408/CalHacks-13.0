"""Record the Pi's live video and microphone into one MP4 on this laptop.

  ./rec.sh -s 10                          # record 10 seconds
  ./rec.sh -s 10 -t 5                     # count down 5 seconds first, then record 10
  ./rec.sh                                # record until Ctrl-C
  ./rec.sh -s 20 -t 3 --label wrong_slot --step s3 --out recordings/lotion_wrong.mp4

-s / --seconds  how long to record (default: until Ctrl-C)
-t / --timer    seconds to count down before recording starts, so you can get into position

Needs ffmpeg (macOS: brew install ffmpeg). Each recording gets a .json next to it with the label
and settings, for the eval clips (AGENTS.md section 16). Video is 480x640 portrait, about 15 fps.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Measured 2026-10-24 with three claps per run, picture minus sound: 0.24/0.22/0.22 s with no
# correction, then 0.10/0.12/0.12 s with 0.23 s of correction (a lag of about 0.34 s that run). The
# lag changes by about 0.1 s between runs, because the two streams start at slightly different
# moments (audio arrives in 125 ms bursts). 0.28 s is the middle; expect up to about 0.06 s off.
# Re-measure with sync_check.py, and pass --av-offset if it differs.
AV_OFFSET_S = 0.28


def build_cmd(host, out, seconds=None, port=8000, audio=True, av_offset=AV_OFFSET_S):
    """The ffmpeg command line.

    Only the video input uses wall-clock timestamps: MJPEG over HTTP has no timing of its own
    (without them ffmpeg assumes 25 fps and the clip plays too fast), while raw PCM has an exact
    clock from its sample rate. Large thread queues stop one live input from stalling the other.
    """
    base = f"http://{host}:{port}"
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
           "-thread_queue_size", "4096", "-use_wallclock_as_timestamps", "1", "-f", "mpjpeg", "-i", f"{base}/stream"]
    if audio:
        cmd += ["-thread_queue_size", "4096", "-itsoffset", f"{av_offset:g}",
                "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", f"{base}/audio"]
    if seconds:
        cmd += ["-t", f"{seconds:g}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-b:a", "64k"] if audio else ["-an"]
    return cmd + ["-movflags", "+faststart", str(out)]


def probe(path):
    """{"video": seconds|None, "audio": seconds|None} from ffprobe."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    res = {"video": None, "audio": None}
    for s in json.loads(out or "{}").get("streams", []):
        res[s["codec_type"]] = float(s.get("duration", 0))
    return res


def check_pi(host, port=8000):
    try:
        return urllib.request.urlopen(f"http://{host}:{port}/health", timeout=3).read() == b"ok"
    except OSError:
        return False


def write_sidecar(out, host, label, step, started, seconds_recorded, av_offset, audio):
    meta = {"file": Path(out).name, "label": label, "step": step, "started_at": started,
            "seconds": seconds_recorded, "host": host, "audio": audio, "av_offset_s": av_offset if audio else None,
            "note": "video 480x640 portrait ~15 fps; audio 16 kHz mono"}
    Path(out).with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
    return meta


def countdown(n, say=print, sleep=time.sleep):
    """Print n, n-1, ... 1, one per second, with a terminal bell so you can hear it start."""
    for i in range(int(n), 0, -1):
        say(f"\a  starting in {i} ...", flush=True)
        sleep(1)


def parse_args(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="10.12.194.1")
    ap.add_argument("-s", "--seconds", type=float, help="stop after this long (default: until Ctrl-C)")
    ap.add_argument("-t", "--timer", type=float, default=0, metavar="SECONDS",
                    help="count down this many seconds before recording starts")
    ap.add_argument("--out", help="output .mp4 (default recordings/<time>.mp4)")
    ap.add_argument("--label", help="for eval clips, for example correct or wrong_slot")
    ap.add_argument("--step", help="step id, for example s1")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--av-offset", type=float, default=AV_OFFSET_S, help="seconds to delay audio (default %(default)s)")
    a = ap.parse_args(argv)
    if a.seconds is not None and a.seconds <= 0:
        ap.error("-s must be greater than 0")
    if a.timer < 0:
        ap.error("-t must be 0 or more")
    return a


def main():
    a = parse_args()
    if not check_pi(a.host):
        sys.exit(f"The Pi at {a.host} is not streaming. Plug in its USB-C cable and run ./start.sh first.")
    countdown(a.timer)
    out = Path(a.out) if a.out else HERE / "recordings" / (datetime.now().strftime("%Y%m%d_%H%M%S") + ".mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    started = datetime.now().isoformat(timespec="seconds")
    t0 = time.monotonic()
    proc = subprocess.Popen(build_cmd(a.host, out, a.seconds, audio=not a.no_audio, av_offset=a.av_offset),
                            stdin=subprocess.PIPE)
    print(f"recording to {out}" + (f" for {a.seconds:g} s" if a.seconds else "; press Ctrl-C to stop"), flush=True)
    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.stdin.write(b"q")  # ask ffmpeg to finish the file cleanly
        proc.stdin.flush()
        proc.wait()
    took = time.monotonic() - t0
    if proc.returncode not in (0, 255) or not out.exists():
        sys.exit(f"ffmpeg failed (exit {proc.returncode})")
    p = probe(out)
    meta = write_sidecar(out, a.host, a.label, a.step, started, round(p["video"] or took, 2), a.av_offset, not a.no_audio)
    print(f"saved {out}  video {p['video'] or 0:.1f} s" + ("" if a.no_audio else f", audio {p['audio'] or 0:.1f} s")
          + f"  (label: {meta['label']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
