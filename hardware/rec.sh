#!/bin/bash
# Record the Pi's video + microphone into recordings/<time>.mp4.
#   ./rec.sh -s 10            record 10 seconds
#   ./rec.sh -s 10 -t 5       count down 5 seconds, then record 10
#   ./rec.sh                  record until Ctrl-C
# More options: ./rec.sh -h   (needs ./start.sh to have run once, and ffmpeg)
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Run ./start.sh once first (it sets up Python)." >&2
  exit 1
fi
exec .venv/bin/python record.py "$@"
