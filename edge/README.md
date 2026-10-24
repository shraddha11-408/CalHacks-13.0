# edge/

Python 3.11 edge app on the laptop. FastAPI on `localhost:8000`.

Owns everything real-time (AGENTS.md §3, §6): camera, frame gating, ArUco
rectify, the three-tier cascade, Cartesia voice, Moss queries, and the
SpacetimeDB HTTP client. The hot path never waits on the network or the database.

## Modules (`stepwise_edge/`)

| Module | What it does |
|---|---|
| `camera.py` | `CameraSource` interface. `LaptopWebcam` (now), `PiStream` (Hardware prompt), `FileSource` (tests/clips). Chosen by `devices.camera`; `STEPWISE_CAMERA=file:<path>` overrides for one run. |
| `gating.py` | `FrameGate`: fires one check after the scene changed and then stayed still for `gate_settle_s`. Signal = share of changed pixels, with hysteresis. |
| `pipeline.py` | Background thread: camera → gate → ArUco detect → rectify. Gate fires with no markers → `look_at_tray`; with markers → `check_ready`. |
| `events.py` | Thread-safe event bus feeding the WebSocket. |
| `config.py` | Loads `config.yaml` + `.env`; `save_hsv` rewrites only the `hsv:` block. |

## Endpoints

- `GET /health`, `GET /stats` (fps, gate state, markers, gate+rectify p50/p99)
- `GET /stream/raw.mjpg`: camera with marker + gate overlays (local only; shows the room)
- `GET /stream/tray.mjpg`: rectified tray, the only image that may leave the device
- `WS /ws/events`: `gate`, `look_at_tray`, `check_ready`, `hsv_saved`
- `POST /calibrate/hsv/sample {x, y}` → HSV range of the clicked patch; `POST /calibrate/hsv {item, lo, hi}` saves it
- `GET /killtests`: Foundation kill-test table

Run alone: `../.venv/bin/uvicorn stepwise_edge.main:app --reload --port 8000` (from `edge/`).
Tests (repo root): `.venv/bin/python -m pytest`.
