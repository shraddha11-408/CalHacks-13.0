# drigil — Agent & Contributor Guide

*Job-coach glasses for workers with intellectual and developmental disabilities · Cal Hacks 13.0 · Oct 23–25, 2026*

This file is the source of truth for anyone (human or agent) changing this repo. Read it before your first edit.
If code and this file disagree, fix one of them in the same change. User-facing overview: [README.md](README.md).
History: the original full vision is archived at [docs/AGENTS_v2_full_vision.md](docs/AGENTS_v2_full_vision.md),
and [PLAN.md](PLAN.md) is the first MVP plan. Where either disagrees with this file, this file wins.

---

## 1. What we are building

A supervisor teaches a task once (a narrated video). From then on the worker's glasses coach them step by step in
the supervisor's consented, cloned voice. Every step is checked by camera, mistakes get a gentle "Almost…" fix,
questions are answered out loud, each worker's past mistakes are remembered, support fades per step as they master
it, and a person (a coworker buddy, then the supervisor) is always one tap away. The goal is a worker who does the
job on their own.

Demo persona: **Jordan** (anonymous), café worker. Next-up task: *Put sleeves on coffee cups*. My tasks: *Clean
the coffee machine*, *Make a venti americano*, *Make a strawberry matcha*.

## 2. Non-negotiables

Cut features, never these. They are enforced in review.

- **Dignity.** First-grade reading level for anything a worker hears or reads. One action per sentence.
  Corrections start with "Almost." plus the fix, never "wrong" or "no" alone. Steps back in support are never
  announced to the worker. Say "people with intellectual and developmental disabilities": capable workers who need
  support.
- **Silence beats a wrong correction.** `unclear` or low confidence → say nothing. Automatic corrections are
  debounced and rate-limited (§5).
- **Privacy.** Faces are blurred in the browser before any frame leaves it. No video of the worker is stored. Teach
  videos are deleted after analysis. Only photos of a correction or a help request are kept, on the laptop.
- **Consent.** A voice is cloned only after the supervisor's explicit consent, and is used only to coach workers on
  their tasks.
- **A person is always one tap away.** Voice "help", the help button, or the wristband. The AI never decides
  discipline or performance.
- **The demo never freezes.** If a model is slow or down, saying "done" or pressing Next moves on. The hot path never
  waits on the database.
- **Only measured numbers** go in the README, the UI or the pitch. Simulated or example data is labeled "Sample".
- **No secrets in the repo.** Keys live only in `.env` (git-ignored). Never print, log or commit them.

## 3. Architecture

```
Browser (React)  ──HTTPS, /api proxy──▶  Edge app (FastAPI, :8000)  ──▶ Claude (Anthropic), Cartesia, Moss
      ▲                                        │ fire-and-forget reducer calls (HTTP)
      └──── live subscriptions (SDK, /v1 proxy) ◀── SpacetimeDB module (local :3000 or Maincloud)
Glasses (Pi 5 + Brio 100) ─USB-C gadget─▶ edge /stream/glasses.mjpg + .pcm ─▶ browser ("Glasses (Pi)")
Uno Q wristband ─USB serial─▶ edge app (wrist.py, devices.wrist: uno_q)
                             or hardware/backend/uno_serial_bridge.py ─▶ POST /wrist/press (devices.wrist: keyboard)
```

- **Browser** owns the camera and mic: MediaPipe hands (pause trigger) and face detection (blur), snapshot crop and
  resize, the always-on mic with voice activity detection, the audio queue and captions. The camera is the laptop
  webcam, the glasses (pick "Glasses (Pi)" in the camera menu), or an uploaded video. The glasses come through the
  edge app (`/stream/glasses.mjpg`, `/stream/glasses.pcm`: the page is https, the Pi is plain http with no CORS);
  `web/src/lib/glasses.ts` turns them into MediaStreams, so hand tracking, blur and snapshots work unchanged. Each
  camera keeps its own work area; the glasses default to the whole frame. The supervisor's teach recorder can use
  the glasses camera and mic (laptop mic if the glasses mic fails).
- **Edge app** owns decisions: live check calls, debounce, corrections, fading outcomes, talk intents, Moss memory,
  Cartesia TTS/STT/cloning, and task storage (`data/`, git-ignored).
- **SpacetimeDB** owns shared state: workers, tasks, sessions, step events and outcomes, mastery (fading), help
  requests, routing and the claim race, wristband calls, talk log, devices and presence.
- Vite serves the web app over HTTPS (self-signed cert in `web/.cert/`, made by `run.sh`) and proxies `/api` to the
  edge app and `/v1` to SpacetimeDB, so phones need only one address.

## 4. Repo map

| Path | What |
|---|---|
| `web/src/pages/` | `Home` (landing), `Why` (research), `Choose`, `Worker` (workday + task run), `SupervisorHome` (dashboard, floor, help, add a task), `Buddy` (buddy phone), `Steps`. Lab pages (`/lab`, `/teach`, `/video`, `/coach`, `/health`) are dev tools. |
| `web/src/components/` | `SiteHeader`/`SiteFooter`/`AppShell`, `Brand` (`BRAND = 'drigil'`), `viz/` (StepTimeline, SupportChip, SupportMeter, CorrectionBubble, StatCard, GlassesMock), `dash/Dashboard`, `LiveCheck`, `CameraStage`, `HeroStory` (landing animation), `GlassesExplorer` (hotspot explorer), `WristButton`, `IncomingCall`, `WorkerFading`, `States` |
| `web/src/lib/` | `api.ts` (edge API client), `audio.ts` (speech queue), `listen.ts` (always-on mic), `vision.ts` (MediaPipe, blur, snapshots), `triggers.ts`, `media.ts` (secure-context camera/mic), `glasses.ts` (Pi camera + mic as MediaStreams), `levels.ts`, `photos.ts`, `glassesHotspots.ts` |
| `web/src/styles/` | `piedra.css` (brand tokens, light + dark), `tokens.css`, `app.css`, `idd.css`, plus one stylesheet per area (`home`, `why`, `worker`, `supervisor`, `dash`, `buddy`, `wrist`, `viz`, `explorer`, `herostory`, `glasses`) |
| `edge/stepwise_edge/` | `api.py` (all HTTP endpoints), `coach.py` (session state + decision rules, pure), `live_vision.py` (live check), `claude.py` + `prompts.py` (teach, answers, judge, locate), `video.py` (teach from video), `voice.py` (Cartesia + voice registry), `memory.py` (Moss), `stdb.py` (SpacetimeDB HTTP client), `progress.py`, `report.py`, `tasks.py`, `vision.py` (Bitdeer, eval only), `agent.py` (Cartesia agent, unused) |
| `spacetime/spacetimedb/src/index.ts` | The SpacetimeDB module. Read `spacetime/docs/SPACETIMEDB_AGENT_RULES.md` before editing. |
| `hardware/`, `wrist/` | Uno Q wristband sketch + serial bridge; Pi 5 + Brio 100 camera/mic streamer and its boot service (`hardware/camera/`), `hardware/start.sh` (checks the whole chain). Details and measurements: `hardware/README.md`, `hardware/TESTING.md`, `wrist/README.md` |
| `scripts/` | `seed_example_tasks.py`, `eval_live_fast.py`, `eval_live_prompt.py`, `compare_models.py`, `stdb_module_check.py`, `smoke_mvp.py`, `killtests/` |
| `docs/` | `IDD_RESEARCH.md` (sourced facts), `FRONTEND_SPEC.md` (page architecture), `UI_GUIDE.md` (brand), archived vision |
| `config.yaml` | Every tunable: models, coach thresholds, devices, SpacetimeDB target. Secrets only in `.env`. |

## 5. The coach loop (edge `api.run_check`)

1. The browser sends a face-blurred frame of the work area every `coach.live_interval_s` (0.5 s), with at most
   `live_parallel` (3) checks in flight. A hand pause checks at once. Snapshots are `live_snapshot_px` (768 px) so
   small printed words stay readable.
2. **One model for every live check:** `models.claude_live` = `claude-sonnet-5-5`, effort low. It sees the frame
   and the whole step list (earlier steps marked `[DONE]`) and returns `status` (done | mistake | in_progress |
   unclear), `done_through`, `confidence`, `reason`, `fix`, `hint` and `box_2d`.
3. **Never go backward:** `done_through` is clamped to at least the current step, and the prompt forbids judging or
   redoing earlier steps.
4. **Debounce (dignity):**
   - "done" with confidence ≥ `done_sure` (0.85) advances on one look. Otherwise it takes 2 dones in a row at least
     `done_min_gap_s` apart. Below `done_confidence` (0.75) it counts as unclear.
   - Automatic corrections need 2 mistakes in a row (3 at support level 3), with a `step_grace_s` (3 s) grace period
     after each new step and at most one correction every 10 s (`thresholds.correction_cooldown_s`).
   - When the worker asks ("Is this right?", Check now, "I'm stuck"), one look answers.
5. Answers about a step that has already changed are dropped (`stale`). Rate limits return `rate_limited` and the
   browser backs off.
6. **Stuck guidance:** after `stuck_after_s` (15/35/60 s, scaled by support level) with no progress: "Take your
   time" plus a hint, then a hint plus "ask me anytime", then an offer of help.
7. Each spoken correction saves a Moss note and logs a `step_event`. Each finished step calls `record_step_outcome`
   (clean | assisted | error).

Bitdeer (`vision.py`) is not in the live path: it was too slow live (p50 ≥ 4.4 s). It stays for the eval scripts.
Switching back is one call in `api.run_check`.

## 6. Teach, voice, talk, memory

- **Teach from video** (`video.py`, `claude.video_tasks`): up to 24 key frames plus a Cartesia-timed
  transcript go to `models.claude` (`claude-opus-5-5`, effort high), which writes the steps.
  - **Prompt rules:** use only what is in this video (never examples from other tasks), and keep prompts short and
    generic.
  - **What a step is:** one result the worker could get wrong; picking up and setting down fold into it. Usually
    4–8 steps.
  - **close_look:** set on steps where success hides in small details.
  - **Upload:** the uploaded video is deleted after analysis. With consent, a narration clip is cloned.
- **Voice** (`voice.py`): Cartesia TTS `sonic-3.6`, STT `ink-whisper`, `voice.clone`. Every phrase uses the task's
  consented clone, else the newest consented clone (`VoiceRegistry.default_id`). The stock voice is used only if no
  clone exists. Clips are cached by text and voice, and task text is pre-recorded on save.
- **Talk** (`/coach/{sid}/talk`): STT → `coach.intent_of` → check | help | stuck | why | repeat | next answer
  instantly. Anything else goes to `models.claude_answer` (Sonnet) with the live frame, the last 4 exchanges, Moss
  notes and the latest check. Echoes of the app's own voice are dropped (`CoachSession.is_echo`).
- **Memory** (`memory.py`, Moss): one index per worker. It is recalled before each step (spoken as "Remember: …"),
  for open questions and for the end-of-task progress summary. If Moss is down, fall back to the step text and never
  go silent.

## 7. SpacetimeDB module

- **Tables:**
  - **Workers and tasks:** `worker`, `task`, `session`, `step_event`, `talk_event`
  - **Fading:** `step_outcome`, `mastery`, `level_change` (event table), `worker_progress` (rollup)
  - **Help:** `help_request`, `help_route`, `claim_attempt`, `wrist_call`
  - **Devices:** `device` (roles edge | supervisor | buddy | worker_screen, with presence)
  - **Voice agent:** `agent_*` tables (unused)
- **Fading rules** (`record_step_outcome`, edge-only, one transaction): `PROMOTE_STREAK` = 3 clean in a row → one
  level less support. `DEMOTE_ERRORS` = 2 errors in the last `WINDOW` = 5 → one level more. The supervisor can
  override with `set_support_level`. Levels: 0 full instruction · 1 short cue · 2 alerts only · 3 on their own.
- **Help:** `request_help` routes to buddies first. The scheduled `escalate_help` moves it to the supervisor after
  20 s. `claim_help` is atomic, so exactly one claimer wins and losers are logged. `call_supervisor` (wristband
  hold) routes straight to the supervisor and records a `wrist_call` (their screen rings). `notify_supervisor`
  (wristband short touch) is a quiet note: routed `notice`, no ringing, no buddy alert, no escalation. Claim and resolve stamp `answered_at`.
- **Scheduled reducers:** `escalate_help`, a presence sweep, and the progress rollup (both every 10 s).
- **Changing the schema:** make additive changes only and publish without wiping data
  (`spacetime publish stepwise --server local --yes`). Then regenerate the bindings into `web/src/module_bindings/`
  and run `scripts/stdb_module_check.py`.

## 8. Frontend rules

- **Brand:** "Piedra" palette, defined in `piedra.css` and documented in `docs/UI_GUIDE.md`.
  - Colors: Río `#0F3B3A`, Pizarra `#2A3133`, Piedra `#C9C5BD`, Musgo `#6F8A4B`.
  - Type: Bricolage Grotesque (display), Onest (body), Spline Sans Mono (numbers and eyebrows), all self-hosted.
  - The wordmark is always lowercase `drigil`.
- **Sol yellow `#F3C14B` means "a person is needed" or "now".** It is never decoration and appears at most once per
  screen.
- **Use semantic tokens** (`--bg`, `--surface`, `--ink`, `--ink-2`, `--line`, `--accent`, `--deep`/`--on-deep`,
  `--help`, `--almost`, `--success`). Never hard-code colors in page CSS: light and dark mode must both work. Theme
  is set by `data-theme` on `<html>`, stored in localStorage `drigil-theme`.
- **Accessibility:**
  - Text contrast at least 4.5:1, verified in light and dark.
  - Tap targets at least 48 px.
  - Works at 390 px wide with no horizontal scroll.
  - Every animation respects `prefers-reduced-motion`.
- **Worker copy:** first-grade reading level, encouraging, no emoji. Supervisor copy: plain and professional.
- **Landing page order:** hero (HeroStory animation + brand corner) → Look closer (GlassesExplorer) → the problem →
  "What they see. What the coach says." (4 café photos, then 3 store/stockroom photos) → "Less help every week"
  → CTA. No citations on the website; sources live in `docs/IDD_RESEARCH.md` and the README.
- **Real photos** live in `web/public/media/` (first-person job photos, task covers, glasses renders).

## 9. Working conventions

- Python for the edge app and hardware bridges; TypeScript for the web app and the SpacetimeDB module; an Arduino
  sketch for the Uno Q. Don't add a second language for any of these.
- Keep the hot path non-blocking: model calls run off the event loop with timeouts, and database writes are
  fire-and-forget (`stdb().call`).
- Every device sits behind an interface chosen in `config.yaml` (`devices.*`).
- **Glasses camera:** the Pi's boot service streams 1280x720 MJPEG rotated to 720x1280 portrait (measured
  2026-10-24: 15.0 fps, frame gap p50/p99 70/74 ms, ~52% of one Pi core; 15.2 fps through the edge). Code must not
  assume landscape. Only one program can open the Uno Q's serial port: the edge app (default) or the bridge.
- Look up current official docs before writing integration code (Anthropic, Cartesia, SpacetimeDB, Moss). Don't
  guess APIs.
- Don't commit or push unless a human asks. Don't touch `data/`, `.env` or `web/.cert/`; they are git-ignored on
  purpose.
- **Restore points:** local git tags `thankgod123` (before the frontend redesign) and `checkpoint-ui-v2` (the
  redesign before dark mode and the wristband).
- When a sponsor service fails, degrade to the next option and keep the worker moving. Silence beats a wrong
  correction.

## 10. Run and test

```bash
cp .env.example .env && $EDITOR .env          # ANTHROPIC_API_KEY, CARTESIA_API_KEY, MOSS_PROJECT_ID/KEY (+ BITDEER for evals)
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm install)
./run.sh                                       # SpacetimeDB :3000 + module publish, edge :8000, web https://localhost:5173
.venv/bin/python scripts/seed_example_tasks.py # example café tasks for the demo worker
.venv/bin/python -m pytest                     # 80 tests
(cd web && npx tsc -b --noEmit && npm test)
.venv/bin/python scripts/stdb_module_check.py  # module rules on a separate test database
```

Before handing work back:
- Run the typecheck and both test suites.
- For UI changes, screenshot desktop and 390 px in light and dark.
- End with a short checklist of what a human should look at.

## 11. Not in the product (kept for later; don't advertise)

- **Factory Droid** checker compiler ([droid/](droid/)): passed a kill-test, but it is not wired into the running
  product.
- **ArUco tray rectification and classical CV checkers** ([cvlib/](cvlib/), `edge/stepwise_edge/pipeline.py`).
- **Cartesia voice agent:** `agent.py` and the `/coach/{sid}/agent*` endpoints. It was replaced by the always-on mic
  because it could not see the camera.
- **Gemini and the Haiku/Sonnet split for live checks:** removed for simplicity and better mistake recall.
- **Glasses mic for live talk:** the Brio mic reaches the teach recorder only; live STT still uses the laptop mic.
