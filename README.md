# drigil: a job coach in their glasses, until they don't need one

**drigil** helps workers with intellectual and developmental disabilities (IDD) learn a new job. A supervisor
records a task once. From then on, smart glasses coach the worker through it step by step, in the supervisor's
own consented, cloned voice. The camera checks each step, mistakes get a gentle "Almost…" correction, the worker
can ask questions out loud, and a person is always one tap away. As the worker masters a step, the coaching for that
step fades: full instruction, then a short cue, then alerts only, then silence. The goal is a worker who does the job
on their own.

Built at **Cal Hacks 13.0** (Oct 23–25, 2026). Every line of code in this repo was written during the event
(first commit: Oct 23, 7:44 PM).

---

## Who it's for

**Workers with IDD in their first weeks at a new job** (café counters, store shelves, stockrooms), and **the job
coaches and supervisors** who support them.

- Only 22.7% of people with a disability were employed in 2024, against 65.5% of people without one
  ([US BLS, 2024](https://www.bls.gov/news.release/disabl.nr0.htm)).
- In state IDD services, 17% of adults had a paid community job, and 44% of those without one said they want one
  (National Core Indicators 2022–23, from a secondary summary; see [docs/IDD_RESEARCH.md](docs/IDD_RESEARCH.md)).
- Job coaches come from a strained workforce: direct support staff turnover was 39.7% in 2023
  ([NCI State of the Workforce](https://idd.nationalcoreindicators.org/wp-content/uploads/2024/11/2023-NCI-IDD-SoTW_241126_FINAL.pdf)).
  A coach can visit a couple of times a week. The rest of the week, small, fixable mistakes add up.

drigil does what job coaches already do. It uses the methods the research supports: breaking a task into small steps,
systematic prompting, fading prompts as skills grow, video and picture models, and coworker ("natural") supports.
The mapping from method to evidence to feature, with 27 sources, is in [docs/IDD_RESEARCH.md](docs/IDD_RESEARCH.md).

<!-- TEAM: if you spoke with a job coach, special-ed teacher or supported-employment worker this weekend, add one
     line here on what you learned and from whom. Never invent a quote. -->

---

## What it does (the demo flow)

1. **Teach once.** The supervisor uploads a short narrated video of the task (Supervisor → *Add a task*). Claude
   watches key frames plus the transcript and writes 4–8 steps. Each step has a plain instruction, what "done right"
   looks like, the likely mistake, an "Almost." correction, a reason, praise, and a short cue for later. With the
   supervisor's consent, a clip of their narration becomes a Cartesia voice clone. The video is deleted after analysis.
2. **Coach live.** The worker (Jordan, in our demo) opens their workday, picks *Put sleeves on coffee cups* and
   presses Start. The camera (the glasses: a Logitech Brio 100 on a Raspberry Pi 5, the laptop webcam, or an uploaded video) streams face-blurred
   frames. For each frame, Claude Sonnet sees the whole step list and says done, mistake or in progress, with a box
   on the mistake and a short fix. The worker hears it in their supervisor's voice.
3. **Talk.** An always-on mic hears "Is this right?", "Why?", "I'm stuck", "What am I holding?" and answers out loud
   using the live camera frame.
4. **Remember.** Moss keeps short notes about each worker ("Jordan turned the sleeve backwards"). Next time, before
   that step, the coach says "Remember: …".
5. **Re-teach with Droid.** If the same step causes 2 corrections or help requests within an hour, Factory Droid
   rewrites that step in a sandbox. The supervisor sees its live work and a before-and-after, and approves.
6. **Fade.** Every finished step is recorded in SpacetimeDB. 3 clean runs in a row lower that step's support one
   level; 2 errors in the last 5 raise it. Level-ups are celebrated out loud. Steps back are never announced to the
   worker.
7. **Help is one tap away.** "Help" (voice or button) pages a coworker **buddy** first. Two buddies race to claim it
   and exactly one wins. After 20 s it escalates to the supervisor. The **wristband** (Arduino Uno Q + touch sensor)
   calls the supervisor directly, and the supervisor page rings on every tab.
8. **Supervisor dashboard.** Who is working now and who needs help, who is getting more independent, which steps
   need re-teaching, and how fast help arrives, all live from SpacetimeDB.

Pages: `/` landing · `/why` the research · `/worker` the worker's workday · `/supervisor` dashboard, floor, help, add
a task · `/buddy` the buddy phone. Light and dark mode.

---

## How it's built

```
 Browser (worker screen)                      Edge app (FastAPI, laptop)                     Cloud
 ───────────────────────                      ──────────────────────────                     ─────
 glasses cam / webcam / video                  /coach/{sid}/check  ──────────────────────▶  Claude Sonnet 5.5 (live check)
 MediaPipe hands + face blur (in-browser)      debounce, corrections, fading outcome         Claude Opus 5.5 (teach from video)
 a frame every 0.5 s, ≤3 checks in flight ──▶  /coach/{sid}/talk  (STT → intent → answer)    Claude Sonnet 5.5 (spoken answers)
 always-on mic (VAD) ─────────────────────▶    Moss memory (in-process recall)  ◀─────────▶  Moss Cloud (index sync)
 audio queue + captions ◀──────────────────    Cartesia TTS clips in the cloned voice ◀───▶  Cartesia sonic-3.6 / ink-whisper / clone
                                              reducers over HTTP (fire-and-forget) ──────▶  SpacetimeDB module
 Supervisor / buddy pages ◀═══════ live subscriptions (SpacetimeDB TypeScript SDK) ═══════   (local server or Maincloud)
 Uno Q wristband ─ USB serial ─▶ edge app (or the bridge) ─▶ /wrist/press ─▶ hold: call_supervisor · short: notify_supervisor
```

| Part | Where | Stack |
|---|---|---|
| Web app | [web/](web/) | React 19 + TypeScript + Vite, MediaPipe Tasks (hands, face), SpacetimeDB TS SDK |
| Edge app | [edge/stepwise_edge/](edge/stepwise_edge/) | Python 3.11, FastAPI, Anthropic SDK, Cartesia SDK, Moss SDK, httpx |
| Realtime backend | [spacetime/spacetimedb/src/index.ts](spacetime/spacetimedb/src/index.ts) | SpacetimeDB 2.x TypeScript module |
| Wristband | [hardware/backend/](hardware/backend/), [hardware/uno_q/](hardware/uno_q/), [wrist/](wrist/) | Arduino Uno Q sketch + Python serial bridge |
| Research and design | [docs/](docs/) | `IDD_RESEARCH.md`, `FRONTEND_SPEC.md`, `UI_GUIDE.md` |

---

## Sponsor technology: what each one does in the running product

### Anthropic (Claude)
- **Teach:** `claude-opus-5-5` (effort high) turns video key frames and the timed transcript into the step list as
  structured JSON ([edge/stepwise_edge/claude.py](edge/stepwise_edge/claude.py), [prompts.py](edge/stepwise_edge/prompts.py)).
- **Live check:** `claude-sonnet-5-5` sees every streamed frame plus the whole step list and returns status, how far
  the worker has got, a mistake box and a fix ([live_vision.py](edge/stepwise_edge/live_vision.py)). Earlier steps are
  marked done, so the coach never sends a worker backward.
- **Talk:** Sonnet answers open questions with the live frame, the last 4 exchanges, Moss notes and the latest check
  result.
- **Where Claude can fail, and what we do about it:**
  - It can call a correct step a mistake. A wrong correction hurts dignity, so automatic corrections need 2 mistake
    answers in a row, there is a 3 s grace period after each new step, and at most one correction every 10 s.
    Low-confidence answers are treated as "unclear", and unclear means silence.
  - It can miss small details (printed words facing the wrong way). Steps where success hides in small details are
    flagged `close_look` at teach time.
  - It can be slow. One look takes about 2.2 s (measured below), so a slow answer about an old step is dropped.
  - The worker can always say "done" or press Next, so the coach never blocks the work.

### Cartesia (voice is the whole interface)
- **TTS:** `sonic-3.6`. Every instruction, correction, praise line and answer is spoken. Instructions are
  pre-recorded when a task is saved, so playback is instant; other lines are generated on demand and cached.
- **Voice cloning (with consent):** the supervisor ticks a consent box when uploading the teach video. A clean clip
  of their narration is cloned (`voice.clone`), and that voice is used only to coach workers on their tasks. All
  speech uses the cloned voice; the stock voice is used only if no consented clone exists.
- **STT:** `ink-whisper` transcribes each utterance from the always-on mic. The app drops anything that matches what
  it just said, so it doesn't answer its own voice.
- **Known limitations:** no hardware echo cancellation (the mic pauses while the app speaks); the clone is only as
  clean as the narration in the teach video; STT can mishear short words, so key intents also have on-screen buttons.
- Setup: `CARTESIA_API_KEY` in `.env`. The voice code is in [voice.py](edge/stepwise_edge/voice.py).

### SpacetimeDB (the shared, live workplace)
One TypeScript module ([index.ts](spacetime/spacetimedb/src/index.ts)) is the authority for everything shared:
- **Tables:** `worker`, `task`, `session`, `step_event`, `step_outcome`, `mastery`, `level_change` (event table),
  `help_request`, `help_route`, `claim_attempt`, `wrist_call`, `talk_event`, `device`, `worker_progress`.
- **Reducers:** `record_step_outcome` applies the fading rules in one transaction and only the edge device may call
  it. `claim_help` is atomic, so of two buddies racing, exactly one wins (losers are logged in `claim_attempt`).
  `set_support_level` (supervisor only), `call_supervisor` (wristband), `register_device` with a heartbeat, and more.
- **Scheduled reducers:** `escalate_help` (an unclaimed buddy request goes to the supervisor after 20 s), a presence
  sweep, and a progress rollup every 10 s.
- **Live subscriptions:** the supervisor dashboard and floor, the buddy phone, the ringing wristband alert and the
  worker's level-up celebration all update instantly from subscriptions.
- `scripts/stdb_module_check.py` checks the rules (device roles, fading, the coach's override, 20 s escalation,
  per-identity views) against a separate test database.

### Moss (each worker's memory)
- A Moss index per worker ([memory.py](edge/stepwise_edge/memory.py)) holds plain-language notes: mistakes made,
  preferences said out loud, progress summaries.
- **Recall before each step:** if a past mistake matches the step, the coach says "Remember: …" before the
  instruction.
- **Recall when the worker asks a question** and for the spoken end-of-task progress summary ("Last time…").
- Queries run in-process after the index loads: p50 1.43 ms, p99 2.68 ms over 100 queries (measured, below). If Moss
  is down, the coach falls back to the step's own text and never goes silent.

### Bitdeer AI Model Studio (model selection)
We used Bitdeer Model Studio's OpenAI-compatible API to pick and tune the vision check
([vision.py](edge/stepwise_edge/vision.py), [scripts/eval_live_prompt.py](scripts/eval_live_prompt.py),
[scripts/compare_models.py](scripts/compare_models.py)). Results on our 30-case labeled set are in the table below.
GLM-5.3-Flash on Bitdeer had the best accuracy and the fewest false corrections of anything we tried. At about
4.4 s per look it was too slow for the live stream, so live checks use Claude Sonnet (about 2.2 s). Switching back is
one call in `api.run_check`.

### Factory Droid SDK (the re-teach engineer)
When a step keeps tripping a worker up, **Droid rewrites that step of the task**. It splits a step that hides two
actions, writes a correction that names the exact fix, adds a "Remember" tip, or flags a close look. A supervisor
approves before anything goes live. Contract: [docs/DROID.md](docs/DROID.md). Runner:
[droid/reteach.mjs](droid/reteach.mjs). Edge side: [droid.py](edge/stepwise_edge/droid.py).
- **Triggers we designed:**
  - **Data event:** 2 spoken corrections or help requests on the same step within an hour start a job
    automatically, at most one per step per hour.
  - **User action:** "Ask Droid to fix this step" on the dashboard's re-teach list.
- **What Droid can touch:** a fresh sandbox folder per job (`droid/sandboxes/<job_id>/`). It holds only the task,
  an evidence file (what went wrong, the corrections spoken, Moss notes, with worker names removed), a rules file and
  a validator. There is no repo, no code and no keys. Droid runs with the SDK at medium autonomy and may write only
  `proposed.json`.
- **Safety built in:** the runner, not Droid, re-runs the validator. It checks the schema, that corrections start
  with "Almost.", that no sentence is over 14 words, and that there are no names or URLs. Anything that fails is
  marked failed. Nothing changes the live task until the supervisor taps **Approve**. Approving replaces the step,
  renumbers the task and pre-records the new lines in the supervisor's cloned voice.
- **Visible work:** every Droid event (plan, tool calls, results, the runner's validation) streams into SpacetimeDB
  (`droid_job`, `droid_event`). The supervisor dashboard shows it live, with a before-and-after of the step and
  Approve / Reject.
- **Measured:** a real run on the coffee-sleeve step took about 35 s with 35 streamed events, the runner's
  validation passed, and Droid split "Pick up the sleeve. Turn it so you can read the words. Make the words right
  side up." into two smaller steps.

### Meta: Bringing People Closer Together
Help goes to a **person who works next to them** before it goes to a manager. "I'm stuck" pages a coworker buddy's
phone first with the step and a photo; the supervisor joins only if nobody answers in 20 s. The AI never replaces the
human: it tells the worker "Help is coming" and gets a coworker there.

### Microsoft: Built for the Real World
- **Customer understanding:** designed around supported-employment practice (task analysis, prompt fading, natural
  supports), mapped feature by feature in [docs/IDD_RESEARCH.md](docs/IDD_RESEARCH.md).
- **Measurable usefulness:** the dashboard measures independence directly: share of steps done with no correction,
  hint or help; steps mastered; steps to re-teach; median time for help to arrive.
- **Path to production:** the laptop stands in for glasses today. Every device sits behind an interface chosen in
  `config.yaml`. The glasses camera already runs: a Raspberry Pi 5 with a Logitech Brio 100 streams over a USB-C link
  to the edge app ([hardware/camera/](hardware/camera/), [hardware/README.md](hardware/README.md)).
  SpacetimeDB runs locally or on Maincloud.
- **Responsible design:** see below.

---

## Measured numbers

Only measured numbers are quoted. Raw results are in [eval/results/](eval/results/) and the edge app's `/killtests`.

**Live step check, 30 labeled frames from the coffee-sleeve task** (originals plus rotated/recolored and
zoomed/mirrored variants):

| Model (provider) | Accuracy | "Done" recognized | Mistakes caught | False corrections | p50 latency |
|---|---|---|---|---|---|
| Claude Sonnet 5.5, effort low (Anthropic), **live** | 73% | 75% | 44% | 6.7% | 2.18 s (p90 2.93 s) |
| GLM-5.3-Flash, prompt v2 + example photo (Bitdeer) | 77% | 75% | 56% | 3.3% | 4.39 s |
| Qwen3.8-27B, prompt v2, no example photo (Bitdeer) | 70% | 83% | 44% | 6.7% | 5.64 s |
| Qwen3.8-27B, prompt v1 + example photo (Bitdeer) | 63% | 67% | 56% | 6.7% | 8.21 s |

Run dates: Oct 24, 2026 (`live_fast.json`, `live_prompt.json`). The live prompt has changed since; re-run with
`.venv/bin/python scripts/eval_live_fast.py`. The debounce rules above exist because of the false-correction column.

**Components** (from the kill-tests, Oct 23): Moss recall p50 1.43 ms / p99 2.68 ms over 100 queries, 5/5 scripted
questions mapped to the right step · Cartesia TTS first audio in 723 ms · laptop camera 640×480 at 29.8 fps.

---

## Real vs. simulated

- **Real:** the teach-from-video pipeline, live camera checks, the cloned voice, speech-to-text answers, Moss memory,
  fading, buddy and supervisor help with the claim race, the wristband call and every dashboard number (computed from
  SpacetimeDB rows).
- **Hardware:** the glasses camera is a Logitech Brio 100 on a Raspberry Pi 5 (the laptop webcam or an uploaded video
  also work). **Stand-ins:** the laptop speaker for
  the earbuds and the laptop mic for the glasses mic. The glasses on the landing page are product renders of our
  concept.
- **Examples:** the "Less help every week" journey on the landing page is labeled Sample. The three tasks under
  *My tasks* (clean the coffee machine, venti americano, strawberry matcha) are seeded examples
  (`scripts/seed_example_tasks.py`). The cover photos are real; their step reference photos are not recorded yet.
- **Voice clone:** a teammate playing the supervisor, recorded with consent.

---

## Responsible design

- **Faces are blurred in the browser** (MediaPipe face detection) before any frame leaves the device. No video of the
  worker is recorded. The teach video is deleted after its steps are written. Only photos of a correction or a help
  request are kept, on the laptop.
- **Consent first:** a voice is cloned only after the supervisor ticks consent, and it is used only to coach workers
  on their tasks.
- **Dignity:** first-grade reading level, one action per sentence, corrections start with "Almost." and never say
  "wrong". No nagging (rate limits above). Silence when unsure. Steps back are never announced to the worker.
- **A person is always one tap away:** voice, button or wristband. The AI never decides discipline or performance.
- **Language:** "people with intellectual and developmental disabilities": capable workers who need support.
- **No secrets in the repo:** all keys live in `.env` (git-ignored). See `.env.example`.

---

## Run it

**Prerequisites:** macOS or Linux, Python 3.11, Node 20+, the SpacetimeDB CLI 2.x (`spacetime`), and keys for
Anthropic, Cartesia and Moss (Bitdeer only for the eval scripts).

```bash
cp .env.example .env                    # fill in the keys
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm install)
./run.sh                                # SpacetimeDB (local :3000) + module publish, edge API (:8000), web (:5173)
.venv/bin/python scripts/seed_example_tasks.py   # optional: the three example café tasks
```

Open **https://localhost:5173**. `run.sh` makes a self-signed certificate on first run, because browsers only allow
the camera and mic on secure pages. Accept the warning once. It also prints a `https://<laptop-ip>:5173` link for
phones on the same network: open `/buddy` there for the buddy phone. If the Wi-Fi blocks devices from reaching each
other (common on event networks), use a phone hotspot.

**Wristband:** `python hardware/backend/uno_serial_bridge.py` with the Uno Q plugged in (hold the sensor for 1.5 s),
or `--simulate` without hardware. Details are in [wrist/README.md](wrist/README.md).

**Tests:**
```bash
.venv/bin/python -m pytest              # coach decision rules, debounce, live-check parsing, progress, voice (80 tests)
(cd web && npm test)                    # trigger engine
.venv/bin/python scripts/stdb_module_check.py   # SpacetimeDB rules against a separate test database
```

---

## What we tried and cut

- **A Droid-compiled image checker per step** (our first idea for Droid) worked in a kill-test, but rule-based
  checks were too fragile on a webcam. Droid now does the re-teaching job above instead.
- **ArUco tray rectification and classical CV checkers** ([cvlib/](cvlib/)) were replaced by a vision model that
  sees the whole step list, which works on any table and camera angle.
- **A Cartesia voice-agent mode** ([agent.py](edge/stepwise_edge/agent.py)) was replaced by the always-on mic,
  because the agent could not see the camera ("What am I holding?" failed).

## Repo map

```
web/                React app (pages in src/pages, brand + components in src/components, styles in src/styles)
edge/stepwise_edge/ FastAPI edge app: api.py (HTTP API), live_vision.py, claude.py, prompts.py, voice.py,
                    memory.py, stdb.py, coach.py (session + decision rules), video.py (teach from video)
edge/tests/         pytest suite
spacetime/          SpacetimeDB module (TypeScript)
hardware/, wrist/   Uno Q wristband (edge serial or bridge); Pi 5 + Brio 100 glasses camera streamer
scripts/            eval, seed and smoke scripts
eval/results/       measured eval output
docs/               IDD research, frontend spec, UI guide, archived full vision
config.yaml         every tunable (models, thresholds, devices); secrets only in .env
```

Contributor and agent rules: [AGENTS.md](AGENTS.md).
