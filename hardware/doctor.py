"""One command to check the whole hardware chain from your laptop.

  ./start.sh                  # sets up Python once, then runs this
  python3 doctor.py           # same, if the dependencies are already installed
  python3 doctor.py --host pi.local --no-open

Plug the Pi's USB-C cable into this laptop first. Steps: Pi reachable, camera streaming,
microphone streaming, video rate, audio rate, wrist node plugged in (optional). Opens the live
video in your browser at the end. Exit code 0 when video and audio both work.
"""
import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "camera"))
sys.path.insert(0, str(HERE / "backend"))

import audio_receiver  # noqa: E402
import receiver  # noqa: E402
from uno_port import find_port  # noqa: E402

DEFAULT_HOSTS = ("10.12.194.1", "pi.local")


def reachable(host, port, timeout=1.5):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def wait_for_pi(hosts, port, wait_s, say=print, sleep=time.sleep, now=time.monotonic):
    """Return the first host that accepts a connection on `port`, polling for up to wait_s."""
    t0, shown = now(), False
    while True:
        for h in hosts:
            if reachable(h, port):
                return h
        if now() - t0 >= wait_s:
            return None
        if not shown:
            say("  waiting for the Pi (the USB network and the stream can take a minute after plugging in)...")
            shown = True
        sleep(2)


def get_status(base):
    return json.load(urllib.request.urlopen(base + "/status", timeout=5))


def check(hosts=DEFAULT_HOSTS, port=8000, wait_s=90, say=print, seconds=3.0):
    """Run every step. Returns {"ok": bool, "host": str|None, "problems": [str], ...}."""
    out = {"ok": False, "host": None, "problems": []}
    say("1. Pi on the USB network")
    host = wait_for_pi(hosts, port, wait_s, say)
    if host is None:
        out["problems"].append(
            "Cannot reach the Pi. Is its USB-C cable in THIS laptop (only one laptop at a time)? "
            "Look for a 'Raspberry Pi USB Gadget' network port, and wait a minute after plugging in. "
            "If the Pi is up but the stream is not, ask the hardware owner to restart it.")
        say("   FAIL")
        return out
    out["host"] = host
    base = f"http://{host}:{port}"
    say(f"   ok: {host}")

    say("2. Camera and microphone are streaming")
    try:
        st = get_status(base)
    except urllib.error.HTTPError as e:
        say(f"   FAIL (HTTP {e.code})")
        out["problems"].append(
            "The Pi is running an older version of the stream (no /status). Ask the hardware owner "
            "to run hardware/camera/deploy_to_pi.sh, then run this again.")
        return out
    except OSError as e:
        say(f"   FAIL ({e})")
        out["problems"].append("The Pi answered the connection but not the status request; try again in a minute.")
        return out
    video_ok = st["video_age_s"] is not None and st["video_age_s"] < 3
    audio_ok = st["audio_enabled"] and st["audio_age_s"] is not None and st["audio_age_s"] < 3
    say(f"   video: {'ok' if video_ok else 'NOT streaming (webcam unplugged or not recognized)'}")
    say(f"   audio: {'ok' if audio_ok else 'NOT streaming (webcam microphone missing)'}")
    if not video_ok:
        out["problems"].append("No video: check the webcam is plugged into the Pi.")
    if not audio_ok:
        out["problems"].append("No audio: the Brio microphone is not producing sound data.")

    if video_ok:
        say("3. Video rate")
        v = receiver.run(base + "/stream", duration=seconds)
        out["video"] = v
        say(f"   {v['fps']:.1f} fps, frame gap p50/p99 {v['gap_ms_p50']:.0f}/{v['gap_ms_p99']:.0f} ms, "
            f"frames {v['shape'][1]}x{v['shape'][0]}")
        if v["fps"] < 12:
            video_ok = False
            out["problems"].append(f"Video is only {v['fps']:.1f} fps (expected about 15).")
    if audio_ok:
        say("4. Audio rate and level")
        a = audio_receiver.run(base + "/audio", seconds=seconds)
        out["audio"] = a
        say(f"   {a['realtime']:.2f}x realtime, peak {a['peak_dbfs']:.1f} dBFS, clipping: {'yes' if a['clipping'] else 'no'}")
        if abs(a["realtime"] - 1.0) > 0.15:
            audio_ok = False
            out["problems"].append(f"Audio runs at {a['realtime']:.2f}x realtime (expected 1.00x).")
        if a["clipping"]:
            out["problems"].append("Audio clips: restart the stream on the Pi to reset the mic gain.")

    say("5. Wrist node (optional)")
    port_name = find_port()
    say(f"   {'found ' + port_name if port_name else 'not plugged in; fine if you are not testing it'}")

    out["ok"] = video_ok and audio_ok
    out["stream_url"] = base + "/stream"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", help="Pi address (default: try 10.12.194.1, then pi.local)")
    ap.add_argument("--wait", type=float, default=90, help="seconds to wait for the Pi")
    ap.add_argument("--no-open", action="store_true", help="do not open the video in the browser")
    a = ap.parse_args()
    r = check((a.host,) if a.host else DEFAULT_HOSTS, wait_s=a.wait)
    print()
    if r["ok"]:
        print(f"ALL GOOD. Live video: {r['stream_url']}")
    else:
        print("PROBLEMS:")
        for p in r["problems"]:
            print(" -", p)
    if r.get("stream_url") and not a.no_open:
        webbrowser.open(r["stream_url"])
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
