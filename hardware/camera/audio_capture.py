"""Runs on the Pi 5: capture the webcam's built-in microphone (ALSA) and feed an AudioHub.

Format on the wire: signed 16-bit little-endian, 16 kHz, mono, in 100 ms chunks.
"""
import atexit
import subprocess
import time

from mjpeg_http import AudioHub

RATE, CHANNELS = 16000, 1
CHUNK_BYTES = RATE // 10 * 2 * CHANNELS  # 100 ms

_procs = []


@atexit.register
def _kill_children():
    for p in _procs:
        p.kill()


def find_card(name: str = "Brio") -> str | None:
    """ALSA card id (e.g. "B100") of the first capture device whose description mentions `name`."""
    out = subprocess.run(["arecord", "-l"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("card ") and name.lower() in line.lower():
            return line.split(":")[1].split("[")[0].strip()
    return None


def set_gain(card: str, value: int) -> bool:
    """Mic Capture Volume, 0..6144 (6 to 30 dB). The device default is the maximum, which clips speech."""
    r = subprocess.run(["amixer", "-c", card, "cset", "name=Mic Capture Volume", str(value)],
                       capture_output=True)
    return r.returncode == 0


def arecord_cmd(card: str):
    return ["arecord", "-q", "-D", f"hw:CARD={card},DEV=0", "-f", "S16_LE",
            "-r", str(RATE), "-c", str(CHANNELS), "-t", "raw"]


def pump(stream, hub: AudioHub, chunk: int = CHUNK_BYTES):
    """Read fixed-size chunks from a byte stream into the hub until it ends."""
    while True:
        data = stream.read(chunk)
        if len(data) < chunk:
            return
        hub.put(data)


def run_forever(hub: AudioHub, gain: int, name: str = "Brio", log=print):
    """Find the mic, set its gain and capture. If the mic is missing or arecord dies (USB re-plug,
    reset), wait and start over, including the gain, which the device resets when re-plugged."""
    warned = False
    while True:
        card = find_card(name)
        if card is None:
            if not warned:
                log(f"no {name} microphone yet; waiting for it", flush=True)
                warned = True
            time.sleep(2)
            continue
        warned = False
        ok = set_gain(card, gain)
        log(f"audio from card {card}, gain {gain}{'' if ok else ' (could not set)'}", flush=True)
        capture_once(card, hub)
        log("arecord stopped; retrying in 2 s", flush=True)
        time.sleep(2)


def capture_once(card: str, hub: AudioHub):
    """Run arecord until it exits, feeding the hub."""
    proc = subprocess.Popen(arecord_cmd(card), stdout=subprocess.PIPE)
    _procs.append(proc)
    try:
        pump(proc.stdout, hub)
    finally:
        proc.kill()
        proc.wait()
