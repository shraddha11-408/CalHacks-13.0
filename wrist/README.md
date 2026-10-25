# wrist/

Arduino Uno Q wrist node: a touch sensor plus the built-in LED matrix, connected to the laptop by **USB serial** (the venue bans hotspots, so no Wi-Fi). The sketch is `hardware/uno_q/wrist_node/wrist_node.ino`; the app side is `edge/stepwise_edge/wrist.py`.

| Touch | What happens |
|---|---|
| Any touch | the matrix flashes once (`ACK`) |
| Hold 1.5 s or more | "I'm stuck": the worker's page sends a help request with a photo; the matrix shows `CALL` once it has gone out |
| Shorter | "What now?": the page says the current step again |

- **Plug and play:** `devices.wrist: uno_q` and `devices.wrist_port: auto` in `config.yaml`. The app finds the board by its USB vendor id (Arduino, `0x2341`) on macOS, Windows and Linux. To force a port: `wrist_port: COM5`. `GET /health` shows `"wrist": "connected on ..."`.
- Only one program can open the serial port. Do not run `hardware/backend/uno_serial_bridge.py` while the app is running; the bridge is a hardware test tool.
- If the page does not answer a hold within 3 s, the server sends the help itself (no photo), so a hold never goes nowhere while a session runs.
- `CALL` also appears when help is sent from the page's button or by voice.
- A second hold on the same step does not page again; it shows `CALL` and the page says "Help is coming."
- **Gap:** with no coaching session running, a hold only logs a warning and sends a `no_session` event; it reaches nobody.
- `devices.wrist: keyboard` turns the wrist node off (use the page's buttons).
