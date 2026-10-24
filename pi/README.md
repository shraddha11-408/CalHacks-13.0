# pi/

Raspberry Pi 5 + OV5647 streamer. Captures with Picamera2 and serves
640x480 MJPEG at ~15 fps to the edge app (AGENTS.md §14). Later: motion gate
and ArUco rectify on-device so only the tray leaves the glasses.

Install on the Pi: `pip install -r pi/requirements.txt` (Picamera2 is usually
preinstalled on Raspberry Pi OS via apt: `sudo apt install python3-picamera2`).
