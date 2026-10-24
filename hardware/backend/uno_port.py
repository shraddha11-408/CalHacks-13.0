"""Find the Uno Q's serial port on any laptop (macOS, Linux; on Windows set UNO_PORT=COM5)."""
import glob
import os

PATTERNS = ("/dev/cu.usbmodem*", "/dev/ttyACM*")


def find_port(env=None, patterns=PATTERNS, globber=glob.glob):
    """UNO_PORT wins. Otherwise the first USB modem device. Returns None if there is none."""
    env = os.environ if env is None else env
    if env.get("UNO_PORT"):
        return env["UNO_PORT"]
    for pattern in patterns:
        matches = sorted(globber(pattern))
        if matches:
            return matches[0]
    return None
