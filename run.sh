#!/usr/bin/env bash
# Starts everything for the MVP on this laptop:
#   SpacetimeDB (local, :3000) + module publish, edge app (:8000), web app (:5173).
# Ctrl-C stops what this script started.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

if [ ! -x "$ROOT/.venv/bin/uvicorn" ]; then
  echo "Missing .venv. Run: ~/.local/bin/python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "Missing web/node_modules. Run: (cd web && npm install)" >&2
  exit 1
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# SpacetimeDB: local server unless config.yaml says maincloud
TARGET=$(grep -A2 '^spacetimedb:' "$ROOT/config.yaml" | awk '/target:/ {print $2}')
if [ "$TARGET" != "maincloud" ]; then
  if ! curl -s -m 1 -o /dev/null http://127.0.0.1:3000/v1/ping; then
    mkdir -p "$ROOT/spacetime/data"
    spacetime start --listen-addr 127.0.0.1:3000 --data-dir "$ROOT/spacetime/data" >"$ROOT/spacetime/data/server.log" 2>&1 &
    pids+=($!)
    for _ in $(seq 1 30); do curl -s -m 1 -o /dev/null http://127.0.0.1:3000/v1/ping && break; sleep 0.5; done
  fi
  (cd "$ROOT/spacetime" && spacetime publish stepwise --server local --yes >/dev/null 2>&1) \
    && echo "spacetimedb: local :3000, module 'stepwise' published" \
    || echo "spacetimedb: publish failed (see: cd spacetime && spacetime publish stepwise --server local)" >&2
fi

# Self-signed cert for the web server (once): camera and mic need https on a LAN address.
CERT_DIR="$ROOT/web/.cert"
LAN_IPS=$( { ipconfig getifaddr en0; ipconfig getifaddr en1; } 2>/dev/null || true)
if [ ! -f "$CERT_DIR/key.pem" ] || [ ! -f "$CERT_DIR/cert.pem" ]; then
  mkdir -p "$CERT_DIR"
  SAN="DNS:localhost,IP:127.0.0.1"
  for ip in $LAN_IPS; do SAN="$SAN,IP:$ip"; done
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -days 825 -subj /CN=localhost -addext "subjectAltName=$SAN" >/dev/null 2>&1 \
    && echo "web: made a self-signed cert for $SAN" \
    || echo "web: openssl failed, serving plain http" >&2
fi

(cd "$ROOT/edge" && exec "$ROOT/.venv/bin/uvicorn" stepwise_edge.main:app --host 127.0.0.1 --port 8000 --reload) &
pids+=($!)
# WEB_HOST=0.0.0.0 ./run.sh  → buddy phones on the same network can open https://<laptop-ip>:5173/buddy
# (the web server also proxies SpacetimeDB and the edge API, so phones need only this one address)
(cd "$ROOT/web" && exec npm run dev -- --host "${WEB_HOST:-127.0.0.1}" --port 5173 --strictPort) &
pids+=($!)

echo "edge: http://localhost:8000/health   web: https://localhost:5173"
for ip in $LAN_IPS; do echo "web (network): https://$ip:5173  (accept the certificate warning once)"; done
wait
