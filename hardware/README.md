# Hardware: Uno Q wrist node

The wrist node is a button plus the Uno Q's built-in LED matrix. It is how a worker asks for help or for a spoken answer. See AGENTS.md §14 for the full hardware list.

## Files

| Path | What it is |
|---|---|
| `uno_q/wrist_node/wrist_node.ino` | Arduino sketch (MCU side): debounces the button, reports presses, drives the LED matrix |
| `backend/uno_serial_bridge.py` | Laptop-side Python script: reads button events over USB serial, classifies press length, sends LED commands back |

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

## Known gaps

- **Transport differs from AGENTS.md.** §14 plans for the Uno Q to POST `/help` to the edge app over Wi-Fi and receive `/status` back. This prototype uses USB serial to the laptop. It is fine for bring-up; switch to Wi-Fi if the wrist node must be untethered.
- `PORT` is hardcoded to one machine. Make it an env var or CLI argument before sharing.
- The LED matrix shows a solid fill or blank. Distinct patterns for *help sent*, *help claimed* and *step done* (§14) are not built yet.
- No reconnect handling if the USB cable is unplugged.
- No tests. The debounce and long-press logic should get tests (AGENTS.md §26).
