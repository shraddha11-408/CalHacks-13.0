"""Wrist node bridge: Arduino Uno Q touch sensor (USB serial) -> edge app.

Protocol (115200 baud, newline-terminated): the Uno sends DOWN / UP; we reply ACK on DOWN and BUZZ
once the supervisor call is sent. A hold of 1.5 s or more is a help request and calls the supervisor
(POST /wrist/press); a shorter touch is a talk request (logged only).

  python hardware/backend/uno_serial_bridge.py [--port /dev/cu.usbmodemXXXX] [--worker jordan]
  python hardware/backend/uno_serial_bridge.py --simulate     # no hardware: press Enter to "touch"

Env: WRIST_PORT, WRIST_WORKER, EDGE_URL (default http://127.0.0.1:8000).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time
import urllib.request

HELP_HOLD_S = 1.5


def press(edge: str, worker: str) -> dict | None:
    body = json.dumps({"worker_id": worker} if worker else {}).encode()
    req = urllib.request.Request(f"{edge}/wrist/press", body, {"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)
    except Exception as e:  # edge app down: tell the person, keep running
        print(f"EDGE: could not reach {edge} ({type(e).__name__}: {e})", file=sys.stderr)
        return None


def find_port() -> str | None:
    ports = sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*"))
    return ports[0] if ports else None


def simulate(edge: str, worker: str) -> None:
    print("Simulating the wristband. Press Enter to hold 1.5 s and call the supervisor; Ctrl-C to quit.")
    while True:
        input()
        print("HELP ALERT (simulated hold)")
        res = press(edge, worker)
        print("BUZZ" if res and res.get("ok") else "not sent", res)


def run(port: str, edge: str, worker: str) -> None:
    import serial  # pyserial

    ser = serial.Serial(port, 115200, timeout=0.1)
    print(f"UNO Q connected on {port}; calling supervisor via {edge}")
    pressed_at = None
    sent = False
    while True:
        line = ser.readline().decode(errors="replace").strip()
        # fire as soon as the hold passes 1.5 s, so the buzz comes while the finger is still down
        if pressed_at is not None and not sent and time.monotonic() - pressed_at >= HELP_HOLD_S:
            sent = True
            print("HELP ALERT")
            res = press(edge, worker)
            if res and res.get("ok"):
                ser.write(b"BUZZ\n")
        if not line:
            continue
        print("UNO:", line)
        if line == "DOWN":
            pressed_at, sent = time.monotonic(), False
            ser.write(b"ACK\n")
        elif line == "UP" and pressed_at is not None:
            if not sent:
                print("TALK REQUEST")
            pressed_at = None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default=os.environ.get("WRIST_PORT"))
    ap.add_argument("--worker", default=os.environ.get("WRIST_WORKER", ""), help="worker id; default: the active session")
    ap.add_argument("--edge", default=os.environ.get("EDGE_URL", "http://127.0.0.1:8000"))
    ap.add_argument("--simulate", action="store_true")
    a = ap.parse_args()
    if a.simulate:
        return simulate(a.edge, a.worker)
    port = a.port or find_port()
    if not port:
        sys.exit("No wrist node found (looked for /dev/cu.usbmodem* and /dev/ttyACM*). Plug in the Uno Q, pass --port, or use --simulate.")
    try:
        run(port, a.edge, a.worker)
    except ImportError:
        sys.exit("pyserial is missing: pip install pyserial")
    except OSError as e:
        sys.exit(f"Could not open {port}: {e}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
