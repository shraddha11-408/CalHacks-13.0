# Droid: the re-teach engineer (contract)

Factory Droid SDK does real work in the running product: when a step keeps tripping a worker up, Droid rewrites
that step of the task (clearer instruction, a split into two smaller steps, a better "Almost." correction, a
"Remember" tip, close_look). A supervisor approves before anything goes live. This file is the shared contract for
every part; change it first if a part needs to change.

## Flow

```
trigger ─▶ edge: POST /droid/reteach ─▶ edge builds sandbox ─▶ node droid/reteach.mjs <sandbox> (subprocess)
                                                                   │ NDJSON events on stdout
edge ◀─────────────────────────────────────────────────────────────┘
  ├─▶ SpacetimeDB reducers droid_job_set / droid_event_log  ─▶ supervisor dashboard (live)
  └─▶ data/droid/<job_id>.json (local job record)
supervisor: Approve ─▶ edge POST /droid/jobs/{id}/approve ─▶ task saved + steps pre-recorded in the cloned voice
```

## Triggers
1. **Data event (auto):** edge counts, per (task_id, step_id), spoken corrections + help requests in the last
   60 min. At 2 → start a job with trigger `auto`. At most one job per (task, step) per 60 min, and never while one
   for that step is queued/running/proposed.
2. **Supervisor action:** "Ask Droid to fix this step" on the dashboard's re-teach list → trigger `supervisor`.

## Sandbox (built by the edge; Droid's cwd; the ONLY thing Droid can touch)
`droid/sandboxes/<job_id>/` (git-ignored), containing:
- `AGENTS.md` — copied from `droid/reteach-template/AGENTS.md` (rules for Droid)
- `validate.py` — copied from `droid/reteach-template/validate.py` (Droid may run it; the runner re-runs it)
- `task.json` — the full task (as stored by the edge), read-only for Droid by convention
- `evidence.md` — target step number + text, what went wrong (reasons + corrections spoken, newest first),
  help requests, Moss notes about the worker (names replaced by "the worker")
- Droid writes `proposed.json` = `{ "steps": [ ...replacement step objects for the target step (1 or 2) ], "why": "one sentence" }`

No repo, no code, no keys, no network tools are needed. Droid runs at `AutonomyLevel.Medium` with cwd = sandbox.

## Runner `droid/reteach.mjs <sandbox_dir>` (Node, @factory/droid-sdk)
- Loads `.env` from the repo root (FACTORY_API_KEY); never prints it. execPath `~/.local/bin/droid`.
- Streams one JSON object per line on stdout:
  - `{"kind":"status","text":"running"}` first
  - `{"kind":"plan"|"text","text":"..."}` assistant text (first assistant message = plan)
  - `{"kind":"tool","text":"<tool name>"}` / `{"kind":"tool_result","text":"ok"|"error"}`
  - `{"kind":"error","text":"..."}`
  - `{"kind":"check","text":"validate: pass" | "validate: <reason>"}` — the RUNNER's own validation
  - last line: `{"kind":"final","ok":true|false,"summary":"...","steps":[...],"why":"...","error":"..."}`
- Timeout 180 s (then final ok=false). Exit code 0 either way.
- Validation (runner runs `python validate.py` itself after Droid finishes; never trusts Droid's claim):
  proposed.json parses; 1–2 steps; each step has non-empty string fields instruction, done_right, common_mistake,
  correction, why, praise, cue and boolean close_look; correction starts with "Almost."; no sentence over 14 words in
  instruction/cue; instruction ≤ 2 sentences; no URLs/HTML; no field mentions a real name from evidence.

## Edge (`edge/stepwise_edge/droid.py` + routes in `api.py`)
- `POST /droid/reteach {task_id, step_id, trigger?="supervisor", reason?}` → `{job_id}` (409 if one is active)
- `GET /droid/jobs` → list of local job records (newest first)
- `POST /droid/jobs/{job_id}/approve` → replaces the target step with the proposed steps (renumber ids 1..n, keep
  reference_photo of the original on the first new step), `store.save`, SpacetimeDB `save_task`, pre-record new text
  in the task's voice; status `approved`
- `POST /droid/jobs/{job_id}/reject` → status `rejected`
- Job ids: `dj_<10 hex>`. Statuses: `queued` → `running` → `proposed` | `failed`; then `approved` | `rejected`.

## SpacetimeDB (additive; edge-only writes via `requireRole(ctx, 'edge')`)
- `droid_job` (public): `id: string (pk)`, `taskId: string`, `stepId: u32`, `trigger: string`, `reason: string`,
  `status: string`, `plan: string`, `summary: string`, `proposal: string` (JSON of proposed.json), `createdAt`,
  `updatedAt` (timestamps)
- `droid_event` (public): `id: u64 (pk, autoInc)`, `jobId: string`, `kind: string`, `text: string`, `at: timestamp`
- Reducers: `droid_job_set(id, taskId, stepId, trigger, reason, status, plan, summary, proposal)` (insert or update,
  keeps createdAt), `droid_event_log(jobId, kind, text)` (text truncated to 500 chars)
- TS bindings: `tables.droidJob`, `tables.droidEvent`, `reducers` not needed by the web (web calls the edge HTTP API).

## Dashboard (web)
- Panel "Droid · re-teach engineer" on the supervisor Dashboard: jobs newest first; each shows step, trigger
  (Auto: "2 corrections in an hour" / Supervisor), status chip, a live event stream (plan, tool calls, the runner's
  validation), and when `proposed`: before (current step) vs after (proposed steps) and **Approve** / **Reject**.
- "Ask Droid to fix this step" button on each row of the re-teach list.
