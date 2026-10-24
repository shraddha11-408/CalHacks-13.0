"""Laptop side: print touch-sensor events from the Pi.

  python3 touch_monitor.py http://<pi-ip>:8000            # run until Ctrl-C
  python3 touch_monitor.py http://<pi-ip>:8000 --count 3  # exit after 3 touches (for validation)
"""
import argparse
import json
import time
import urllib.request


def get_json(url, timeout=15):
    return json.load(urllib.request.urlopen(url, timeout=timeout))


def iter_events(base: str, poll_timeout: float = 10.0):
    """Yield touch events ({'seq', 'type': 'down'|'up', 'ts'}) forever; survives reconnects."""
    since = None
    while True:
        try:
            if since is None:
                since = get_json(f"{base}/touch")["seq"]  # ignore history from before we connected
            r = get_json(f"{base}/touch/events?since={since}&timeout={poll_timeout}", timeout=poll_timeout + 5)
            for ev in r["events"]:
                yield ev
            since = r["seq"]
        except OSError as e:
            print(f"connect failed ({e}); retrying in 2 s")
            time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", help="e.g. http://10.12.194.1:8000")
    ap.add_argument("--count", type=int, default=0, help="exit after N touches (0 = forever)")
    args = ap.parse_args()
    print(f"state: {get_json(args.base.rstrip('/') + '/touch')}\nwaiting for touch (Ctrl-C to quit)...")
    downs, down_ts = 0, None
    try:
        for ev in iter_events(args.base.rstrip("/")):
            if ev["type"] == "down":
                downs, down_ts = downs + 1, ev["ts"]
                print(f"TOUCH DOWN  #{downs}")
            else:
                held = f"  held {ev['ts'] - down_ts:.2f}s" if down_ts else ""
                print(f"TOUCH UP{held}")
                if args.count and downs >= args.count:
                    break
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
