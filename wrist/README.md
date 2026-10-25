# wrist/

Arduino Uno Q wrist node ("wristband"). A touch sensor (sensor OUT to MCU pin 2, 3.3 V, HIGH = touched)
and the LED matrix. Sketch: `hardware/uno_q/wrist_node/wrist_node.ino`. Bridge: `hardware/backend/uno_serial_bridge.py`.

## What it does
Hold the wristband sensor for 1.5 seconds or more: the supervisor is called. A shorter touch is a talk
request (logged only).

```
touch sensor -> Uno Q --USB serial 115200 (DOWN / UP)--> bridge --POST /wrist/press--> edge app
                                                                                      |
   Uno replies ACK on DOWN, BUZZ when the call is sent <---- bridge                   v
                                       SpacetimeDB reducer call_supervisor -> help_request (routed straight to
                                       the supervisor, no buddy stage) + wrist_call row -> supervisor screen rings
```

The edge app also says "Okay. I'm calling your supervisor now." in the task's voice (the response of
`POST /wrist/press` carries the audio URL). Presses within 5 s of each other count once.

## Run with the hardware
1. Plug the Uno Q into the laptop by USB. Start the edge app (`/coach/start` a session as usual).
2. `python hardware/backend/uno_serial_bridge.py` (finds `/dev/cu.usbmodem*`; or `--port`, `WRIST_PORT`).
   Optional `--worker jordan` / `WRIST_WORKER`; default is whoever has an active session.
3. Hold the sensor 1.5 s. The bridge prints `HELP ALERT` and the Uno gets `BUZZ`. Needs `pip install pyserial`.

## Run without the hardware
- Terminal: `python hardware/backend/uno_serial_bridge.py --simulate`, press Enter.
- curl: `curl -X POST localhost:8000/wrist/press -H 'content-type: application/json' -d '{"worker_id":"jordan"}'`
- Browser: the round "Press to call your supervisor" button on the worker screen (`WristButton`).
- Check the call: `spacetime sql stepwise --server local "SELECT * FROM wrist_call"`.

`GET /wrist/status` returns the press count, the last press and the active sessions.
