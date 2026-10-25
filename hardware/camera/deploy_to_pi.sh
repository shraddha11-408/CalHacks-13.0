#!/bin/bash
# For the hardware owner, from a laptop on the Pi's USB link: copy the streamer to the Pi and
# (re)install the boot service (sudo asks for the Pi password in your terminal) so camera + microphone start by themselves after every reboot.
#   ./deploy_to_pi.sh                 # pi@10.12.194.1
#   ./deploy_to_pi.sh pi@pi.local
set -e
HOST=${1:-pi@10.12.194.1}
cd "$(dirname "$0")"
ssh "$HOST" 'mkdir -p ~/stepwise_camera'
scp mjpeg_http.py uvc_streamer.py audio_capture.py pi_restart.sh stepwise-camera.service "$HOST":stepwise_camera/
# stop a hand-started copy so it does not hold port 8000 (the bracket keeps this command from matching itself)
ssh "$HOST" 'pkill -f "[u]vc_streamer.py" || true; sleep 1'
ssh -t "$HOST" 'sudo cp ~/stepwise_camera/stepwise-camera.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl enable stepwise-camera && sudo systemctl restart stepwise-camera'
sleep 6
echo "service: $(ssh "$HOST" 'systemctl is-active stepwise-camera; systemctl is-enabled stepwise-camera' | tr '\n' ' ')"
curl -s -m5 "http://${HOST#*@}:8000/health"; echo
