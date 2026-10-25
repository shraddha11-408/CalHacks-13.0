# wrist/

Arduino Uno Q wrist node: a touch sensor plus the built-in LED matrix, connected to the laptop by **USB serial** (the venue bans hotspots, so no Wi-Fi). The sketch is `hardware/uno_q/wrist_node/wrist_node.ino`; the app side is `edge/stepwise_edge/wrist.py`.

| Touch | What happens |
|---|---|
| Any touch | the matrix flashes once (`ACK`) |
| Hold 1.5 s or more | **Call the supervisor** (`call_supervisor`): their screen rings until someone answers; the matrix shows `CALL` once the call has gone out; the worker hears "Okay. I'm calling your supervisor now." |
| Shorter | **A quiet note to the supervisor** (`notify_supervisor`): a line in the supervisor's help list, marked as a note; nothing rings, no buddy alert, no escalation; the worker hears "Okay. I told your supervisor." |

Both go through `POST /wrist/press` (`kind: call | notify`, the code in `api.wrist_press`) and carry the newest
face-blurred live frame as the photo. A second press of the same kind within 5 s counts once.

- **Plug and play:** `devices.wrist: uno_q` and `devices.wrist_port: auto` in `config.yaml`. The app finds the board by its USB vendor id (Arduino, `0x2341`) on macOS, Windows and Linux. To force a port: `wrist_port: COM5`. `GET /health` shows `"wrist": "connected on ..."`.
- Only one program can open the serial port. Do not run `hardware/backend/uno_serial_bridge.py` while the app reads the board; the bridge is the other way in (below).
- The edge sends the call or note itself (no waiting on the page); the worker's page only speaks the reply.
- `CALL` also appears when help is sent from the page's help button, by voice, or from the on-screen wristband button.
- **Gap:** with no coaching session running, a touch only logs a warning and sends a `no_session` event; it reaches nobody.
- `devices.wrist: keyboard` turns the wrist node off (use the page's buttons).

## Verified on the real board (2026-10-24)

- The port was found by vendor id with no setting (`/dev/cu.usbmodem...` on a Mac).
- Measured on the real Uno Q (2026-10-24): 17 quick taps were HIGH for 0.09-1.14 s and two 1 s presses for 1.06 and 1.23 s, all read as short; four 2-3 s holds were 2.20-2.77 s, all read as help, and `CALL` showed correctly on the 13x8 matrix. Early on, three quick taps read as 2.8-6.7 s (the sensor stayed HIGH); this did not happen again and the cause is unknown, so re-check with the sensor worn on the wrist.
- Unplugged: status went to "not connected", then "no Uno Q found; plug it in". Re-plugged 90 s later: connected again by itself and touches came through, with no restart.
- Not verified here: the whole app (worker page speaking, help reaching a phone), because the app's dependencies were not installed on the test laptop.

## Other way in: the bridge and the on-screen button (`POST /wrist/press`)

Use this when the edge app is not reading the board (`devices.wrist: keyboard`): only one program can open
the serial port. Same two actions as above: hold = call, shorter = note.

### What it does
Hold the wristband sensor for 1.5 seconds or more: the supervisor is called (the bridge fires as soon as the
hold passes 1.5 s). A shorter touch sends the supervisor a quiet note (`kind: notify`).

```
touch sensor -> Uno Q --USB serial 115200 (DOWN / UP)--> bridge --POST /wrist/press--> edge app
                                                                                      |
   Uno replies ACK on DOWN, BUZZ when the call is sent <---- bridge                   v
                                       SpacetimeDB reducer call_supervisor -> help_request (routed straight to
                                       the supervisor, no buddy stage) + wrist_call row -> supervisor screen rings
```

The edge app also says "Okay. I'm calling your supervisor now." in the task's voice (the response of
`POST /wrist/press` carries the audio URL). Presses within 5 s of each other count once.

### Run with the hardware
1. Set `devices.wrist: keyboard` in `config.yaml`. Plug the Uno Q into the laptop by USB. Start the edge app (`/coach/start` a session as usual).
2. `python hardware/backend/uno_serial_bridge.py` (finds `/dev/cu.usbmodem*`; or `--port`, `WRIST_PORT`).
   Optional `--worker jordan` / `WRIST_WORKER`; default is whoever has an active session.
3. Hold the sensor 1.5 s. The bridge prints `HELP ALERT` and the Uno gets `BUZZ`. Needs `pip install pyserial`.

### Run without the hardware
- Terminal: `python hardware/backend/uno_serial_bridge.py --simulate`, press Enter.
- curl: `curl -X POST localhost:8000/wrist/press -H 'content-type: application/json' -d '{"worker_id":"jordan"}'`
- Browser: the round "Press to call your supervisor" button on the worker screen (`WristButton`).
- Check the call: `spacetime sql stepwise --server local "SELECT * FROM wrist_call"`.

`GET /wrist/status` returns the press count, the last press and the active sessions.
