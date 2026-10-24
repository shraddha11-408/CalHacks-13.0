# Hardware

Code for the glasses (Pi 5 camera and touch sensor) and the wrist node (Uno Q). See AGENTS.md §14 for the full hardware list.

- **Wrist node (Uno Q):** a button plus the built-in LED matrix. The worker asks for help or for a spoken answer.
- **Glasses (Pi 5):** OV5647 camera streamed as MJPEG to the laptop, plus a touch sensor on GPIO14.

## Files

| Path | What it is |
|---|---|
| `uno_q/wrist_node/wrist_node.ino` | Arduino sketch (MCU side): debounces the button, reports presses, drives the LED matrix |
| `backend/uno_serial_bridge.py` | Laptop-side Python script: reads button events over USB serial, classifies press length, sends LED commands back |
| `camera/pi_streamer.py` | Runs on the Pi 5: Picamera2 -> MJPEG over HTTP, and mirrors the GPIO14 touch sensor |
| `camera/mjpeg_http.py` | Stdlib HTTP server shared by the streamer and the test server (`/stream`, `/snapshot.jpg`, `/health`, `/touch`, `/touch/events`) |
| `camera/receiver.py` | Laptop side: reads the stream, prints fps, frame gap p50/p99, decode time (`--show` for a preview window) |
| `camera/touch_monitor.py` | Laptop side: prints touch down/up events from the Pi |
| `camera/fake_server.py`, `camera/test_stream.py` | Pi stand-in and unit tests (no Pi needed) |

## Wiring

- Button between digital pin **2** and 3.3 V/5 V (check your board's logic level), with an **external 10 kΩ pull-down** to GND. The sketch uses `INPUT`, not `INPUT_PULLUP`, so pressed = `HIGH`.
- Jumper wires only, no soldering at the venue.

## Serial protocol (115200 baud, newline-terminated)

| Direction | Message | Meaning |
|---|---|---|
| Uno → laptop | `DOWN` | Button pressed (debounced, 40 ms) |
| Uno → laptop | `UP` | Button released |
| Laptop → Uno | `ACK` | Press seen: LED matrix lights solid for 200 ms |
| Laptop → Uno | `BUZZ` | Help sent: LED matrix blinks (150 ms) for 1 s |

Commands are limited to 32 characters. Unknown commands are ignored.

## Press logic (backend)

1. `DOWN` → record the time and reply `ACK` right away, so the worker sees the press registered.
2. `UP` → measure the hold time.
   - **>= 1.5 s** → `HELP ALERT`, reply `BUZZ`. This is the "I'm stuck" request.
   - **< 1.5 s** → `TALK REQUEST` (a short press, for a spoken question or "what now?").

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
python3 pi_streamer.py                 # --width --height --fps --port; --touch-pin 0 disables touch

# On the laptop (opencv-python-headless + numpy)
cd hardware/camera && python3 -m venv .venv
.venv/bin/pip install opencv-python-headless numpy
.venv/bin/python receiver.py http://<pi-ip>:8000/stream --duration 10
.venv/bin/python receiver.py http://<pi-ip>:8000/stream --show      # preview, q to quit
.venv/bin/python -m unittest test_stream -v                         # no Pi needed
```

The server keeps only the newest frame, so a slow client skips frames instead of building up lag. Any number of clients can connect. `/snapshot.jpg` returns one JPEG; `/health` returns `ok` once frames are flowing.

## Touch sensor (Pi 5, GPIO14)

A digital touch sensor (for example a TTP223 module) on **BCM GPIO14** (header pin 8).

| Sensor pin | Pi 5 header |
|---|---|
| VCC | pin 1 (3.3 V) |
| GND | pin 6 |
| OUT | pin 8 (GPIO14) |

- The streamer reads it with gpiozero (30 ms debounce) and assumes **HIGH = touched**. For a sensor that pulls LOW, start with `--touch-active-low`.
- `GET /touch` returns `{"pressed": bool, "count": n, "seq": n}`.
- `GET /touch/events?since=<seq>&timeout=<s>` long-polls and returns `{"seq": n, "events": [{"seq", "type": "down"|"up", "ts"}]}`.
- Check it from the laptop: `.venv/bin/python touch_monitor.py http://<pi-ip>:8000` (add `--count 3` to exit after three touches).
- GPIO14 is also UART0 TXD. If you enable the serial console or `enable_uart` on the Pi, the pin is taken; leave it off.

## Known gaps

- **Transport differs from AGENTS.md.** §14 plans for the Uno Q to POST `/help` to the edge app over Wi-Fi and receive `/status` back. This prototype uses USB serial to the laptop. It is fine for bring-up; switch to Wi-Fi if the wrist node must be untethered.
- `PORT` is hardcoded to one machine. Make it an env var or CLI argument before sharing.
- The LED matrix shows a solid fill or blank. Distinct patterns for *help sent*, *help claimed* and *step done* (§14) are not built yet.
- No reconnect handling if the USB cable is unplugged.
- No tests for the wrist-node debounce and long-press logic (AGENTS.md §26). The camera server and touch endpoints have tests in `camera/test_stream.py`.
- Touch on the real GPIO14 pin is verified end to end (Pi pin -> `/touch/events` -> laptop monitor), but an earlier run saw no events, probably loose wiring or touch timing. Check the wiring holds before the demo.
- The touch sensor has no job in the product yet. Decide what a touch does (for example "repeat" or "next") and wire it to the edge app.
