# Checker sandbox rules (read by Droid)

You are writing ONE deterministic image checker for one task step.

- Only edit files under `checkers/` and `tests/`. Do not touch anything else.
- Use the helper library in `cvlib/` (numpy + OpenCV). No network, no new dependencies.
- Signature: `check(rectified: np.ndarray, ref: dict) -> {"status": "done" | "not_done" | "wrong", "error_type": str | None, "confidence": float}`
- Write your own tests in `tests/` using the training frames you are given. Run them with the Python given in the prompt.
- Never push, deploy, or use git. The runner (not you) runs the held-out tests.
