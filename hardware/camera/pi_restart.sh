#!/bin/bash
# Run ON the Pi (from the copy in ~/stepwise_camera): restart the camera + microphone stream.
#   bash pi_restart.sh --rotate 270        (arguments go to uvc_streamer.py)
cd ~/stepwise_camera
pkill -f "python3 -u uvc_streamer.py"
sleep 2
setsid nohup python3 -u uvc_streamer.py "$@" > streamer.log 2>&1 < /dev/null &
sleep 5
head -1 streamer.log
curl -s localhost:8000/health; echo
