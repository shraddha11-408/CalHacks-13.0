# IDD Help (Stepwise) — job coach glasses (Cal Hacks 13.0 MVP)

Glasses that learn a task by watching a supervisor do it once, then coach a worker with an
intellectual or developmental disability step by step: check each step with the camera, gently
correct mistakes, answer questions by voice, remember each person's past mistakes, and call the
supervisor when help is needed. Plan: [PLAN.md](PLAN.md). Agent rules: [AGENTS.md](AGENTS.md).

## Run it

```bash
./run.sh          # SpacetimeDB (local :3000) + edge API (:8000) + web (:5173)
```
Open http://localhost:5173. Keys live only in `.env` (see `.env.example`).

| Page | Who | What |
|---|---|---|
| **Teach** `/teach` | Supervisor | Do the task once. Key frames are taken when hands pause; Claude writes the steps; edit; Save pre-records all audio (Cartesia). |
| **Coach** `/coach` | Worker | Big instruction + reference photo. MediaPipe watches the hands in the browser; a snapshot goes to Bitdeer only on a trigger. Talk / Help buttons, spacebar = temple button (tap = talk, hold 1 s = help). |
| **Supervisor** `/` | Supervisor | Live from SpacetimeDB: help alerts with photo (claim/resolve), live sessions, event log, mistakes by step, Moss memories. |
| **Health** `/health` | Team | Sponsor kill-test results. |

## How the loop works

- **Triggers** (browser, `web/src/lib/triggers.ts`): hands still ~0.8 s · hands leave the work area · voice "done"/"is this correct?" · 8 s timeout. Triggers are ignored while a check is in flight.
- **Snapshot** (`web/src/lib/vision.ts`): sharpest recent frame → faces blurred → cropped to the work area → 512 px. Only this leaves the browser. No video is recorded.
- **Check** (`edge/stepwise_edge/api.py`): Bitdeer vision model with the step's reference photo, `done_right`, `common_mistake` → done ("Great!" + next) · mistake (correction, logged, Moss note) · in progress (quiet) · unclear or low confidence twice → Claude with the last 3 frames.
- **Never freezes**: if the models are down, saying "done" or pressing Next moves on.
- **Talk**: push-to-talk audio → Cartesia STT → "what's next / again / why" answered instantly (no model call), "is this correct?" runs a check, anything else → Claude with the frame.
- **Remember**: Moss session index per worker, queried in-process before each step ("Remember: …").

## Sponsors (where each is used)

| Sponsor | Used for |
|---|---|
| Claude (`claude-opus-5-5`) | Step list from key frames; unclear checks (last 3 frames); open questions |
| Bitdeer | Every step check (`models.bitdeer_vision` in config.yaml) |
| Cartesia | All speech (pre-recorded clips + on-demand), speech-to-text for push-to-talk |
| Moss | Per-worker memory of mistakes and preferences, queried before each step |
| SpacetimeDB | Event log, sessions, help requests, live supervisor dashboard (replaces Convex) |

Skipped (no key / not MVP): Convex, Bitdeer Nemotron Omni (not in our catalog), Factory, Apify, Notability.

## Numbers

Quote only measured numbers. The Supervisor page computes everything from real SpacetimeDB rows.
Accuracy: collect ~30 labeled snapshots from the Coach page (**Test set** panel), then
`.venv/bin/python scripts/compare_models.py --claude` → `eval/results/model_compare.json`.

## Tests

```bash
.venv/bin/python -m pytest          # edge + cvlib (decision rules, gating, rectify, ...)
(cd web && npm test)                # trigger engine
.venv/bin/python scripts/smoke_mvp.py   # end-to-end API smoke test (real model calls)
```
