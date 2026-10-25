# droid/

Node runner for the Factory Droid SDK (`@factory/droid-sdk`).

Claims a `compile_job`, copies `checker-template/` into `sandboxes/<job_id>/`
(a plain folder, not a git worktree — see AGENTS.md §5 deviation), runs Droid
at medium autonomy with training frames only, then runs the held-out set itself.
Every Droid event becomes a `compile_event` row.

`sandboxes/` is gitignored.

## Re-teach engineer (`reteach.mjs`)

Contract: [docs/DROID.md](../docs/DROID.md). When a step keeps tripping a worker up, Droid rewrites that one
step (clearer instruction, a split into two steps, an exact "Almost." correction, the remembered tip,
`close_look`). A supervisor approves before anything goes live.

```
node droid/reteach.mjs droid/sandboxes/<job_id>
```

**Sandbox** (built by the edge, Droid's cwd, the only thing it touches): `AGENTS.md` and `validate.py`
copied from `reteach-template/`, plus `task.json` and `evidence.md`. Droid writes `proposed.json`
(`{"steps": [1-2 steps], "why": "..."}`). No repo, no code, no keys in the sandbox.

**Safety:** medium autonomy (edit files, run commands; never push or deploy); 180 s timeout, then the session
is closed. The runner, not Droid, re-runs `validate.py` (stdlib only: 1-2 steps, all fields, `Almost.`
corrections, ≤14 words per sentence, ≤2 instruction sentences, no URLs/HTML, no names from an optional
`Names:` line in evidence.md). Nothing goes live until a supervisor approves on the dashboard.

**Events:** one JSON object per line on stdout, also saved to `<sandbox>/events.jsonl`:
`status` (first) → `plan` (first assistant message) / `text` / `tool` (tool name) / `tool_result`
(`ok`|`error`) / `error` → `check` (the runner's `validate:` line) → `final`
(`{ok, summary, steps, why, error}`). Exit code is always 0.

Manual test (2026-10-25, coffee-sleeve step 2): ~32 s, Droid split the step into "words face out" and
"words right side up", `close_look: true`, runner check `validate: pass`, final `ok: true`.
