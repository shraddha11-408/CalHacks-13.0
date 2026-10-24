# droid/

Node runner for the Factory Droid SDK (`@factory/droid-sdk`).

Claims a `compile_job`, copies `checker-template/` into `sandboxes/<job_id>/`
(a plain folder, not a git worktree — see AGENTS.md §5 deviation), runs Droid
at medium autonomy with training frames only, then runs the held-out set itself.
Every Droid event becomes a `compile_event` row.

`sandboxes/` is gitignored.
