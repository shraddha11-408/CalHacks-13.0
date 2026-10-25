# Testing the hardware from your own laptop

Everything below was checked on the team's setup on 2026-10-24 unless marked **not tested**.

## 1. Without any hardware (any laptop, 2 minutes)

```bash
git clone https://github.com/sudoanmol/Calhacks_Stepwise && cd Calhacks_Stepwise/hardware
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # needs Python 3.10+ and ffmpeg
cd camera  && ../.venv/bin/python -m unittest discover               # camera, audio, rectify: 31 tests
cd ..    && .venv/bin/python -m unittest test_doctor                    # the start.sh checker, against a fake Pi
cd backend && ../.venv/bin/python -m unittest test_uno_port       # wrist-node port detection
```

`ffmpeg` is only needed for `test_uvc.py` (macOS: `brew install ffmpeg`).

## 2. Plug in and run one command

```bash
cd Calhacks_Stepwise/hardware
./start.sh          # macOS / Linux. Windows: not tested
```

1. **Move the Pi's USB-C cable to your laptop** (only one laptop at a time; the cable is the network).
2. Run `./start.sh`. The first run creates a Python environment and installs the packages (opencv is about 50 MB, so allow a few minutes); later runs start right away.
3. It waits up to 90 s for the Pi (the USB network and the stream need about a minute after plugging in), then checks the camera, the microphone, the video rate, the audio rate and whether the wrist node is plugged in. It prints `ALL GOOD` and opens the live video in your browser, or prints what to fix.

Options: `./start.sh --no-open` (no browser), `--host pi.local`, `--wait 180`.

The Pi starts the camera and microphone stream **by itself at boot** (systemd service `stepwise-camera`, installed 2026-10-24). Nobody needs to log in to the Pi.

What the tester sees: your laptop gets a `10.12.194.x` address automatically (the Pi hands it out) and the Pi is `10.12.194.1`. macOS shows a "Raspberry Pi USB Gadget" network port; Linux gets a `usb0`/`enx...` interface through NetworkManager.

## 3. What to run

From `hardware/camera` (use `../.venv/bin/python`):

| Check | Command | Expected (measured) |
|---|---|---|
| Live video | open `http://10.12.194.1:8000/stream` in a browser | upright picture (the camera is mounted sideways and rotated in software; frames are 480x640 portrait) |
| One frame | `curl -o a.jpg http://10.12.194.1:8000/snapshot.jpg` | a JPEG |
| Video rate | `python receiver.py http://10.12.194.1:8000/stream --duration 10` | 15 fps, frame gap p50/p99 about 70/72 ms |
| Microphone | `python audio_receiver.py http://10.12.194.1:8000/audio --seconds 10 --save a.wav` | 1.00x realtime, no clipping; play `a.wav` and check you can hear and understand yourself |
| Live level | `python audio_receiver.py http://10.12.194.1:8000/audio --meter` | bars move when you talk |
| Wrist node | `cd ../backend && ../.venv/bin/python uno_serial_bridge.py` | see "Wrist node" |
| Record video + sound | `cd .. && ./rec.sh -s 10 -t 3` (-s seconds to record, -t countdown first) | `recordings/<time>.mp4` with a video and an audio track (needs ffmpeg) |
| Everything at once | `./start.sh` (from `hardware/`) | `ALL GOOD` |

Use the audio in your own code: `from audio_receiver import iter_pcm` then `for pcm, t in iter_pcm("http://10.12.194.1:8000/audio"): ...`. `pcm` is a numpy int16 array of 100 ms at 16 kHz mono. The Pi sends it in bursts of about 125 ms.

## 4. Wrist node (Arduino Uno Q)

1. Flash `uno_q/wrist_node/wrist_node.ino` (Arduino IDE or App Lab). **The sketch with the 13x8 `CALL` frames has not been flashed or verified yet.**
2. Plug the Uno Q into your laptop and run the bridge. It finds the port by itself (`/dev/cu.usbmodem*` on macOS, `/dev/ttyACM*` on Linux). Several boards plugged in, or Windows: `UNO_PORT=/dev/cu.usbmodemXXXX` (`UNO_PORT=COM5`).
3. Short touch (< 1.5 s): one flash, prints `TALK REQUEST`. Long touch (>= 1.5 s): prints `HELP ALERT` and the matrix shows `CALL` for 2 s.
4. Alignment check: send `TEST` over the serial port; a full one-pixel border should appear for 3 s.

## 5. If something fails

`./start.sh` prints the fix for most of these.

| Symptom | Likely cause |
|---|---|
| "Cannot reach the Pi" | cable is in another laptop; charge-only cable; the Pi is still booting (wait a minute); macOS got a `169.254.x.x` address instead of `10.12.194.x` (unplug and replug the cable, or toggle the "Raspberry Pi USB Gadget" network port off and on) |
| "older version of the stream (no /status)" | the Pi still runs old code; the hardware owner runs `camera/deploy_to_pi.sh` |
| "No video" | the webcam is not plugged into the Pi, or not recognized |
| "No audio" | the Brio microphone is missing (it is part of the same webcam) |
| Video is sideways | the stream runs without `--rotate 270` (the service passes it) |
| Audio clips | restart the service; it sets the mic gain to 3072 (the device default clips) |
| Bridge says no serial port | the Uno Q is not plugged in, or set `UNO_PORT` |

For the hardware owner (needs the Pi login, which is not in this repo): `camera/deploy_to_pi.sh` copies the streamer and reinstalls the service; on the Pi, `journalctl -u stepwise-camera -f` shows the logs and `sudo systemctl restart stepwise-camera` restarts it. The stream recovers by itself if the webcam or its microphone is unplugged and plugged in again.

## Known gaps

- **Power-cycling works; a software reboot did not.** After the service was installed, unplugging and re-plugging the USB-C cable (Pi powers off and on) brought the Pi back with the stream running by itself: systemd started it 8 s after boot, no restarts, nobody logged in; the laptop ran `./start.sh` and got `ALL GOOD`. Once, though, `sudo reboot` on the Pi did not bring it back on the USB link within 7 minutes and only the re-plug fixed it. The cause is unknown (Pi side or the laptop's USB network port). For testers, re-plugging is the normal path; avoid `sudo reboot` over this link.
- The stream has **no password and no encryption.** Anyone who can reach the Pi can watch the camera and hear the microphone. Today that is only the laptop on the USB cable. Do not put the Pi on venue Wi-Fi without deciding that on purpose.
- One laptop at a time. Sharing the stream with several testers needs the Pi on a shared network, or one laptop relaying it.
- Speech recognition on `/audio` is not wired up (Cartesia's STT still reads the laptop microphone).
- Unplugging the webcam while streaming, and the recovery described above, are covered by unit tests of the restart logic only, not tried on the real device.
