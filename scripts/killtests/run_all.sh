#!/usr/bin/env bash
# Runs every Foundation kill-test and prints the pass/fail table.
# Results land in scripts/killtests/results.json (shown on the web Health page).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/.venv/bin/python"
cd "$ROOT/scripts/killtests"

"$PY" kt_camera.py
"$PY" kt_aruco.py
"$PY" kt_bitdeer.py
"$PY" kt_cartesia.py
# SpacetimeDB: publish the module, then call it from Python
(cd "$ROOT/spacetime" && PATH="$HOME/.local/bin:$PATH" spacetime publish "$(grep '^SPACETIMEDB_MODULE=' "$ROOT/.env" | cut -d= -f2)" --yes >/dev/null 2>&1) \
  || echo "[WARN] spacetime publish failed (run: ~/.local/bin/spacetime login)"
"$PY" kt_spacetime.py
(cd "$ROOT/droid" && node kt_droid.mjs)
"$PY" kt_moss.py

"$PY" table.py
