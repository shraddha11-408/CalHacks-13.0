# checkers/

Compiled per-step checkers, one file per step: `checkers/<step_id>.py`.
Each exposes `check(rectified, ref) -> {"status", "error_type", "confidence"}`.
Written by Droid in a sandbox, published only after the runner's held-out tests pass.
Run in a subprocess with a 200 ms timeout and no network.
