import serial
import time

PORT = "/dev/cu.usbmodem638911932"

ser = serial.Serial(PORT, 115200, timeout=0.1)

pressed_at = None

print("UNO Q connected")

while True:
    line = ser.readline().decode(
        errors="replace"
    ).strip()

    if not line:
        continue

    print("UNO:", line)

    if line == "DOWN":
        pressed_at = time.monotonic()
        ser.write(b"ACK\n")

    elif line == "UP" and pressed_at is not None:
        duration = time.monotonic() - pressed_at
        pressed_at = None

        if duration >= 1.5:
            print("HELP ALERT")
            ser.write(b"BUZZ\n")
        else:
            print("TALK REQUEST")
