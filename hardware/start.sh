#!/bin/bash
# Plug the Pi's USB-C cable into this laptop, then run:  ./start.sh
# Sets up Python the first time (needs python3 3.10+), then checks camera, mic and wrist node
# and opens the live video. Extra arguments go to doctor.py (for example --no-open, --host).
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "First run: creating .venv ..."
  python3 -m venv .venv
fi
if [ ! -f .venv/.deps-installed ] || [ requirements.txt -nt .venv/.deps-installed ]; then
  echo "Installing Python packages (opencv is ~50 MB, this can take a while) ..."
  .venv/bin/pip install -q --default-timeout=60 -r requirements.txt
  touch .venv/.deps-installed
fi
exec .venv/bin/python doctor.py "$@"
