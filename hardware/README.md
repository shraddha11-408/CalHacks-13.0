# Hardware

Code for the glasses (Pi 5 camera) and the wrist node (Uno Q). See AGENTS.md §14 for the full hardware list.

The venue bans phone hotspots, so nothing here is wireless: the **Pi 5 runs in USB gadget mode** (Ethernet over its USB-C cable to the laptop; in bring-up it answered at `10.12.194.1`) and the **Uno Q talks USB serial** to the laptop.

- **Wrist node (Uno Q):** a touch sensor plus the built-in LED matrix. The worker asks for help or for a spoken answer. The touch sensor replaced the button; the sketch and bridge are unchanged because both produce the same `DOWN` / `UP` events.
- **Glasses (Pi 5):** OV5647 camera streamed as MJPEG to the laptop. Microphone (DJI Mic Mini receiver on the Pi) and audio streaming are not built yet.

## Files

| Path | What it is |
|---|---|
| `uno_q/wrist_node/wrist_node.ino` | Arduino sketch (MCU side): debounces the touch input, reports touches, drives the LED matrix |
| `backend/uno_serial_bridge.py` | Laptop-side Python script: reads touch events over USB serial, classifies hold length, sends LED commands back |
| `camera/pi_streamer.py` | Runs on the Pi 5: Picamera2 -> MJPEG over HTTP |
| `camera/mjpeg_http.py` | Stdlib HTTP server shared by the streamer and the test server (`/stream`, `/snapshot.jpg`, `/health`) |
| `camera/receiver.py` | Laptop side: reads the stream, prints fps, frame gap p50/p99, decode time (`--show` for a preview window) |
| `camera/rectify.py` | `rectify(frame, marker_ids)` -> top-down tray image, or `None` if a marker is missing. Also a CLI for checking a snapshot |
| `camera/aruco_markers.py` | Generates printable ArUco markers (DICT_4X4_50, ids 0-3) into `camera/markers/` |
| `camera/test_rectify.py` | Rectify tests on synthetic camera views (tilt, rotation, missing markers, latency) |
| `camera/fake_server.py`, `camera/test_stream.py` | Pi stand-in and unit tests (no Pi needed) |

## Wiring

- **Touch sensor** (a digital module such as a TTP223): OUT to digital pin **2**, VCC to 3.3 V, GND to GND. The sketch reads pin 2 with `INPUT` (no internal pull), so touched = `HIGH`. A module with a driven output needs no pull-down; the sketch comment "External 10k pull-down required" dates from the button and a pull-down does no harm.
- The sensor must be momentary (HIGH only while touched). A module set to toggle mode would break the hold-length logic.
- Jumper wires only, no soldering at the venue.

## Serial protocol (115200 baud, newline-terminated)

| Direction | Message | Meaning |
|---|---|---|
| Uno → laptop | `DOWN` | Touch started (debounced, 40 ms) |
| Uno → laptop | `UP` | Touch ended |
| Laptop → Uno | `ACK` | Press seen: LED matrix lights solid for 200 ms |
| Laptop → Uno | `BUZZ` | Help sent: LED matrix blinks (150 ms) for 1 s |

Commands are limited to 32 characters. Unknown commands are ignored.

## Press logic (backend)

1. `DOWN` → record the time and reply `ACK` right away, so the worker sees the touch registered.
2. `UP` → measure the hold time.
   - **>= 1.5 s** → `HELP ALERT`, reply `BUZZ`. This is the "I'm stuck" request.
   - **< 1.5 s** → `TALK REQUEST` (a short touch, for a spoken question or "what now?").

Right now both outcomes only print to the console. The next step is to forward them to the edge app (help → `request_help` reducer in SpacetimeDB, which pages the buddy first and the supervisor after 20 s).

## Run it

```bash
# 1. Flash wrist_node.ino to the Uno Q (Arduino IDE or arduino-cli)
# 2. Find the serial port
ls /dev/cu.usbmodem*
# 3. Set PORT in backend/uno_serial_bridge.py, then:
pip install pyserial
python hardware/backend/uno_serial_bridge.py
```

## Camera stream (Pi 5 -> laptop)

Camera: OV5647, captured with Picamera2 (`cv2.VideoCapture(0)` will not see it). Default 640x480 at 15 fps.

```bash
# On the Pi (copy hardware/camera/{pi_streamer,mjpeg_http}.py over)
python3 pi_streamer.py                 # --width --height --fps --port

# On the laptop (opencv-python-headless + numpy)
cd hardware/camera && python3 -m venv .venv
.venv/bin/pip install opencv-python-headless numpy
.venv/bin/python receiver.py http://<pi-ip>:8000/stream --duration 10
.venv/bin/python receiver.py http://<pi-ip>:8000/stream --show      # preview, q to quit
.venv/bin/python -m unittest test_stream -v                         # no Pi needed
```

The server keeps only the newest frame, so a slow client skips frames instead of building up lag. Any number of clients can connect. `/snapshot.jpg` returns one JPEG; `/health` returns `ok` once frames are flowing.

## ArUco markers and rectify

Print `camera/markers/tray_markers_a4.png` at **100% scale** (no "fit to page") and check one marker edge with a ruler: it should be 7 cm. Regenerate at another size with `python3 aruco_markers.py --size-cm 6`. Stick them on the tray corners: **0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left**, flat, with their white border left intact.

```bash
.venv/bin/python rectify.py http://<pi-ip>:8000/snapshot.jpg --out tray.jpg   # markers seen + saved top-down view
.venv/bin/python -m unittest test_rectify -v
```

- The rectified view (default 640x480) spans the rectangle between the four marker **centers**. Keep the slots inside it.
- All four markers must be visible. Otherwise `rectify()` returns `None` and the caller says "Look at the tray, please" and does not check.
- Synthetic scenes: detect + rectify takes about 1.5 ms (budget 50 ms, AGENTS.md §6). Not yet measured on a real tray; marker size at 40-60 cm distance is the thing to confirm first.

## Known gaps

- Rectify is tested on synthetic views only. Run `rectify.py` against a live snapshot with the printed markers on the tray before relying on it.
- `PORT` is hardcoded to one machine. Make it an env var or CLI argument before sharing.
- The LED matrix shows a solid fill or blank. Distinct patterns for *help sent*, *help claimed* and *step done* (§14) are not built yet.
- No reconnect handling if the USB cable is unplugged.
- No tests for the wrist-node debounce and hold-length logic (AGENTS.md §26). The camera server has tests in `camera/test_stream.py`.
- Uno Q serial is confirmed working (reported by the hardware owner, not measured here). Still worth checking: the touch sensor is momentary, and a 1.5 s hold gives `HELP ALERT`.
- Not built yet: DJI Mic Mini capture on the Pi and streaming that audio to the laptop; playing Cartesia TTS on the MacBook speaker; barge-in without echo cancellation (AGENTS.md §14).
- What a touch should do beyond help/talk is still undecided.
