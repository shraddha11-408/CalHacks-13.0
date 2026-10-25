# Stepwise v2 — Agent Build Guide

*Job-coach glasses · Cal Hacks 13.0 · Oct 23–25, 2026 · Palace of Fine Arts, SF · team of 4*

This file is the source of truth for anyone (human or agent) writing code in this repo. Read it fully before your first edit. If code and this file disagree, this file wins until it is updated.

> ## MVP decision record (2026-10-23) — read first
>
> The team agreed on a smaller MVP: **[PLAN.md](PLAN.md)**. Where PLAN.md and the rest of
> this file disagree, **PLAN.md wins**. The original full vision is archived unchanged at
> [docs/AGENTS_v2_full_vision.md](docs/AGENTS_v2_full_vision.md); the sections below are kept
> for reference and for post-MVP work.
>
> What changes for the MVP:
> - **Demo task:** PLAN.md names towel folding; the current supervisor demo video (`videos/supervisor.mp4`) is a coffee-sleeve task.
> - **Real-time layer:** MediaPipe hands + motion in the browser; snapshot triggers = hands pause
>   ~0.8 s, hands leave the work area, voice "done"/"is this correct?", 8 s timeout. ArUco/tray
>   rectification and cvlib checkers are not on the MVP path (code stays for later).
> - **Checking:** Bitdeer vision model per snapshot → Claude with the last 3 frames when unclear or
>   low confidence twice. No Droid-compiled tier in the MVP.
>   **Temporary (2026-10-24):** Bitdeer is paused in the live check (p50 ~4–8 s was too slow to follow
>   a worker). The Steps page streams continuously (a frame every 0.6 s, 2 checks in flight, no waiting
>   for a hand pause). **Live check = one model, Claude Sonnet, on every frame**
>   (`edge/stepwise_edge/live_vision.py`, `models.claude_live`): each call sees the whole step list and returns
>   status, `done_through`, the mistake box and fix. The Haiku/Sonnet split, Gemini and the Opus escalation
>   were removed from the live path for simplicity and mistake recall (Haiku caught 0% of the sleeve mistakes).
>   **Debounce (§6):** automatic checks advance on 2 dones ≥ 0.6 s apart and correct on 2 mistakes in a row
>   (3 s grace after each new step, 10 s cooldown); 1 look is enough when the worker asks (voice, button, stuck).
>   An unclear answer to "is this correct?" gets the "not sure" phrase. The Bitdeer call is commented out in
>   `api.run_check`; numbers in `eval/results/live_fast.json`.
> - **Database:** SpacetimeDB replaces Convex (no Convex key). Photos live on the edge laptop; rows hold their paths.
> - **Talk:** Nemotron Omni is not in our Bitdeer catalog → Cartesia STT → intent → answer → Cartesia TTS.
> - **Memory:** Moss holds plain-language notes about each worker (mistakes, preferences), queried before each step.
> - **Privacy:** faces blurred in the browser before any frame leaves it; no video recorded or stored.
> - **Out of MVP:** Factory, Apify, Notability.
> - **Added after the MVP cut (2026-10-24):** fading support, buddy routing with 20 s escalation, consented
>   voice cloning. SpacetimeDB is the authority for fading: `mastery` (level per worker × step),
>   `record_step_outcome` (edge-only reducer, §10 rules in one transaction), `set_support_level`
>   (supervisor-only), `step_outcome` history, `level_change` event table, per-identity `my_mastery` view,
>   `device` roles + presence (lifecycle hooks, heartbeat, scheduled sweep), scheduled `escalate_help` and
>   `rollup`. Checks: `scripts/stdb_module_check.py` (separate test database).
> - **Voice agent (2026-10-24):** "Talk with ⟨coach⟩" on the worker screen opens a Cartesia Managed Agent
>   (model `claude-haiku-5.5` in Cartesia's catalog, the task's consented cloned voice) straight from the browser
>   with a short-lived agent token; the API key stays on the edge (`edge/stepwise_edge/agent.py`, one agent per
>   voice, definition in code). Its six client tools (`what_is_my_step`, `check_my_work`, `call_a_helper`,
>   `my_progress`, `change_step`, `remember`) run on the edge app (`/coach/{sid}/agent/tool`). Browser tokens
>   cannot send dynamic variables, so the agent gets the worker and task from its first tool call. SpacetimeDB:
>   `agent_call` (owned by the screen's identity), private `agent_turn` / `agent_tool_call` read only through the
>   supervisor-only views `supervisor_transcript` / `supervisor_tool_calls`, `coach_end_call` (supervisor ends a
>   call; the screen hangs up), `agent_stats` rollup (measured response p50/p90). Checks: `scripts/agent_smoke.py`.
> - **Voice agent off the worker page (2026-10-24):** the Cartesia agent never sees the camera (its tools return
>   text only), so "What am I holding?" failed. The worker talks through the always-on mic again: Cartesia STT →
>   fixed intents (check, help, stuck, why, repeat, next) or Claude (`claude_answer`) with the live camera frame, the last
>   4 exchanges and the live check's latest result → Cartesia TTS in the coach's cloned voice (`/coach/{sid}/talk`).
>   The agent code (`agent.py`, `/coach/{sid}/agent*`, Layer E tables) stays for later but nothing calls it.
> - **Hardware:** laptop webcam/mic/speaker; on-screen button + spacebar stands in for the temple button.

---

## 1. What we are building

Stepwise is a job coach in glasses for workers with intellectual and developmental disabilities (IDD). **The coach teaches a task once. The glasses keep coaching in her voice, check every step, and need her less every week.**

Pitch line: "Jordan's job coach can visit twice a week. The other three days, she taught the glasses once, and they coach him in her voice."

The loop, in one pass:

1. **Teach once (Claude).** The coach demonstrates while narrating. Claude turns video + narration into a task spec: steps, success criteria, likely mistakes, instructions at three support levels.
2. **Compile checkers (Factory Droid).** For every step a simple image rule can verify, Droid writes and tests a deterministic checker in a sandbox. Only checkers that pass held-out tests go live.
3. **Coach with a three-tier cascade.** Cheapest tier that can decide: compiled checker (ms, free) → Bitdeer vision model → Claude only when the first two disagree.
4. **Speak in her voice (Cartesia).** Every instruction is spoken in the coach's cloned voice, with her consent.
5. **Remember in the worker's own words (Moss).** Every step phrasing, correction and resolved help note is indexed on the laptop; the worker's questions are answered from that memory in single-digit milliseconds, in-process.
6. **Fade support.** Per step: full instruction → short cue → mistake alerts only → silence, as the worker masters it.
7. **Help that builds relationships.** The wrist touch sensor pages a nearby coworker buddy first, then the supervisor. Every worker and request is on a live floor in SpacetimeDB.

**Real vs. simulated.** The task, the checks, the voice, the help requests and every latency/cost number are real and measured. Multi-week fading data is simulated from scripted sessions and must be labeled "simulated" on every screen and slide. The voice clone is a teammate playing the coach, recorded with consent. Never clone a real coach without permission.

> Add a real quote from a job coach or supported-employment worker if we get one. If we don't, say what we learned and from whom. Never invent a quote.

### What changed from v1

| Area | v1 | v2 |
|---|---|---|
| Step checking | One vision model call per check | Three-tier cascade: Droid-compiled checker → Bitdeer → Claude on disagreement |
| Camera view | Raw head-mounted frames | ArUco markers on the workspace → rectified, stable top-down view |
| Privacy | Face blurring | Only the rectified work surface leaves the device; faces never sent |
| Voice | Generic TTS | The coach's cloned voice (consented) |
| Memory / questions | Static step text or a full model call | Moss index of the coach's own phrasings, queried in-process (<10 ms) |
| Backend | Convex | SpacetimeDB live floor (Convex not entered) |
| Help | Supervisor alert | Buddy first, supervisor after 20 s; claimed once, never double-handled |
| Factory | Not used | Droid compiles and tests a checker per step, triggered by a newly taught task |
| Demo task | Towel folding (hard to verify) | Guest amenity tray (visually distinct right/wrong), plus one fold step to show the cascade |
| Proof | Claims | Eval harness: labeled clips, per-tier precision, false-correction rate, latency, cost |

Dropped entirely: Fetch.ai, Capital One, CRS, Elastic, ElevenLabs, Convex, CREAO, Visa, Apify, Bright Data, Coinbase, Hyphenate. Moss is **in** (see §7).

---

## 2. Non-negotiables

Cut features, never these: **step checking, the coach's voice, the live floor, the measured numbers, the Moss-backed question path.**

Hard rules, enforced in code review:

- **The hot path never waits on the network or the database.** Vision checks, verdicts, voice and Moss queries run in the edge process on the laptop. `log_verdict` is a reducer call fired *after* speech has already started.
- **Only the rectified work surface leaves the device.** Cloud models see the top-down tray image, never faces or the room. No video is stored; only step reference photos, with consent.
- **No reason to correct → silence.** `unclear` is not a verdict to act on.
- **No secrets in the repo.** Anthropic, Bitdeer, Cartesia, Factory, SpacetimeDB, Moss: environment variables only. Never commit `.env`.
- **Language and tone:** first-grade reading level, one action per sentence, never "wrong" or "no" alone — always "Almost." plus the fix. People with intellectual and developmental disabilities are capable workers who need support.
- **Every quoted number is measured.** If it isn't in the eval output, it doesn't go in the README, the floor, or the pitch. Simulated data is labeled simulated wherever it appears.

---

## 3. Architecture

```
                 TEACH (once per task)                         COACH (every step, all shift)
 Coach demo + narration                              OV5647 on Pi 5 ─USB gadget─> Edge app (laptop)
        │                                                               │ frame gating (motion settle)
        ▼                                                               │ ArUco → rectified work surface
   Claude ──> TaskSpec JSON ──┐                                         ▼
        │                     │                       Tier 1: compiled checker (ms, free)
        ▼                     ▼                               │ unsure / no checker
 Labeled frames        compile_job row                        ▼
 (free from timeline)        │                        Tier 2: Bitdeer vision model
        │                    ▼                                │ low confidence / disagrees
        └──────> Droid runner (worktree, tests)               ▼
                       │ passes held-out tests        Tier 3: Claude
                       ▼                                      │
                 checker: shadow → deployed                   ▼
                                                     Verdict → Cartesia voice (coach's clone) → MacBook speaker
                                                              ▲
                     DJI Mic RX (Pi) ─> STT ──> worker question        │
                                             │                │
                                             ▼                │
                              Moss (in-process, <10 ms) ──────┘  (retrieved phrasing, else static, else Claude)

 Uno Q wrist node ─USB serial─> Edge app                         ▼
 (help + LED matrix)                          SpacetimeDB module (Maincloud)
                                              tables · reducers · scheduled jobs · procedures
                                                     │ live subscriptions
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                      Coach floor (web)      Buddy phone page      Weekly report (procedure → Claude)
```

**Division of labor:** the laptop owns everything real-time; SpacetimeDB owns shared state (who is on which step, verdicts, help requests, mastery, checkers, compile events); Moss owns the words the coach actually said.

---

## 4. Teach mode (Claude)

One narrated demonstration becomes a task spec in under a minute. It runs once per task, so use Claude's best reasoning.

1. The coach presses "teach" and does the task while talking ("First the blue soap goes in the top-left slot"). She may do one step wrong on purpose and say "this is wrong."
2. The edge app records frames and audio; speech-to-text gives a timestamped transcript.
3. Keyframes are picked by scene change: when the rectified tray view settles for ~1 s after a change.
4. Claude receives keyframes + transcript + timestamps and returns a `TaskSpec` as structured JSON.
5. The coach sees the steps with photos and can fix any step by voice ("step 3 is the lotion"). Route the edit through Claude again and re-publish; do not hand-edit JSON in the UI state.
6. **Labels come free from the timeline:** frames after step *k* completes are positives for *k*; frames before it are negatives; the deliberate mistake is a negative with an error type. These feed the checker compiler and the eval harness.

```json
{
  "task_id": "amenity_tray_v1",
  "title": "Set up a guest amenity tray",
  "workspace": { "type": "aruco_tray", "marker_ids": [0, 1, 2, 3] },
  "steps": [
    {
      "id": "s1",
      "instruction": {
        "full": "Pick up the blue soap. Put it in the top-left slot.",
        "cue": "Soap, top left.",
        "picture_card": "frames/s1_ref.jpg"
      },
      "success": "A blue bar is inside the top-left slot.",
      "region": "slot_A",
      "common_errors": [
        { "type": "wrong_slot", "correction": "Almost. The soap goes in the top-left slot." }
      ],
      "checkable_by_rule": true,
      "hazards": []
    }
  ]
}
```

Prompt rules: first-grade reading level; one action per sentence; never "wrong" or "no" alone. `checkable_by_rule` marks steps a simple image rule can verify; those go to the compiler.

On publish: write one `compile_job` row per `checkable_by_rule` step, and index the task into Moss (§7). Both happen in the same publish path so a taught task is never half-live.

---

## 5. Checker compiler (Factory Droid)

Droid is an employee that builds a product component on a trigger we designed, not a bug-fixer. Factory's brief rewards a designed trigger, tight scope over what Droid touches, and visible plans and diffs; it marks down chatbot wrappers and untraceable work.

Flow:

1. A published `TaskSpec` creates one `compile_job` row per `checkable_by_rule` step.
2. The Droid runner (Node, `@factory/droid-sdk`) claims a job and creates a git worktree from the `checker-template` repo. The template holds no secrets.
3. Droid runs at medium autonomy: it may edit files and run tests. It may never push or deploy.
4. Droid gets the step spec plus **training** frames only. It writes `checkers/<step_id>.py` and its own tests.
5. **The runner (never Droid) runs the held-out set** — frames Droid never saw, including the deliberate mistake. Pass bar: every held-out positive and negative classified correctly.
6. Passing checkers publish with status `shadow`. In shadow they run alongside Bitdeer on live checks. After 10 agreeing live checks they are promoted to `deployed`; any disagreement drops them back to `shadow`.
7. Every Droid event (plan, tool call, diff, test result) becomes a `compile_event` row, streamed live on the floor.

**Deviation (sandboxes):** instead of a git worktree, the runner copies `droid/checker-template/` into a plain folder per compile job (`droid/sandboxes/<job_id>/`, gitignored). We avoid git operations during the build; the isolation and "Droid never pushes or deploys" guarantees are unchanged. Wherever this file says "worktree", read "per-job sandbox folder".

**Helper library** (this is what makes it feasible in 36 h). Droid composes checkers from a small, tested library instead of writing raw CV:

- `rectify(frame, marker_ids)` → top-down tray image (ArUco homography)
- `region(img, name)` → crop for a named slot
- `color_fraction(crop, hsv_range)` → share of pixels in a color range
- `count_blobs(crop, hsv_range, min_area)` → number of objects
- `template_score(crop, ref_crop)` → similarity to the reference frame

```python
def check(rectified: np.ndarray, ref: dict) -> dict:
    # returns {"status": "done" | "not_done" | "wrong", "error_type": str | None, "confidence": float}
```

**Safety:** checkers run in a subprocess with a 200 ms timeout and no network. A crashing or timing-out checker is retired automatically and the step falls back to Bitdeer.

**Fallback if Droid isn't ready:** the cascade becomes Bitdeer → Claude, and we show a pre-compiled checker with its recorded Droid session in the Factory slice.

---

## 6. Coach loop (the three-tier cascade)

1. **Frame gating.** Only check when the scene changed and then settled (frame diff below threshold for ~0.5 s). This cuts calls by an order of magnitude.
2. **Rectify.** ArUco markers → homography → top-down tray view. No markers found → say "Look at the tray, please" and don't check.
3. **Tier 1 — compiled checker** (if `deployed`). Confident result → verdict.
4. **Tier 2 — Bitdeer vision model.** Inputs: rectified frame, reference frame, success text, common errors. Output: verdict JSON.
5. **Tier 3 — Claude.** Only when Bitdeer confidence < 0.7, or Bitdeer disagrees with a shadow checker. Before calling it, attach 2–3 prior corrections for this step from Moss (§7) — cheap grounding, Claude still decides.

```json
{ "step_id": "s1", "status": "done | not_done | wrong | unclear",
  "error_type": "wrong_slot | null", "confidence": 0.0, "tier": "checker | bitdeer | claude",
  "latency_ms": 0, "cost_usd": 0.0 }
```

**Debounce and dignity rules** (test these, they are the product):

- Advance only after 2 consecutive `done` verdicts at least 1 s apart.
- Correct only after 2 consecutive `wrong` verdicts with the same `error_type`.
- At most one correction per step every 10 s. No nagging.
- `unclear` → stay silent. A wrong correction is worse than no correction.
- On `done`: a short positive ("Nice.") at support level 0; silence at levels 1–3.

**Latency budget** (targets to measure Friday night, not claims): gating + rectify < 50 ms; checker < 50 ms; Bitdeer ≤ ~1.5 s; Moss query < 10 ms; Claude only on rare escalation. Voice starts streaming as soon as the verdict lands.

---

## 7. Moss: the coach's memory, in-process

Moss is a sub-10 ms retrieval runtime embedded in the application. Indexes are built on Moss Cloud and loaded into memory; **queries never leave the laptop**, which is exactly the privacy story we already tell. That makes it the right place for guidance text — it is fast enough to answer a question mid-task and it keeps the worker's own history local.

Python SDK (edge app): `pip install moss` → `MossClient(project_id, project_key)`, `create_index`, `load_index`, `query(name, text, QueryOptions(top_k=3))`. TypeScript SDK (`@moss-js/moss`) if a JS component needs it. Credentials via env: `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`.

### Indexes

| Index | Contents | Used by |
|---|---|---|
| `guidance_<worker_id>` | Every step's `full`, `cue` and `correction` at each support level; coach overrides from the floor; resolved help notes; past `prompt_event` lines | Worker voice questions; escalation context |
| `task_library` | All published `TaskSpec` steps (title, instruction, success text, common errors) with `task_id` / `step_id` metadata | Coach floor search box; "have we taught this already?" |

Re-index `guidance_<worker_id>` whenever a step's support level changes, a checker retires, or a help request resolves with a note. Re-index `task_library` on every publish. Indexing happens off the hot path.

### Query paths

1. **Worker question** ("what now?", "how does this go?", "slower"): STT → `query(guidance_<worker>, q, top_k=3)` filtered by `step_id` and `support_level` → if the top score clears threshold, speak the retrieved coach phrasing verbatim through Cartesia. If it doesn't, speak the static `TaskSpec` instruction. Only if neither exists do we ask Claude.
2. **Escalation context:** before the Claude tier, retrieve 2–3 prior corrections for the step and include them in the prompt.
3. **Floor search:** coach queries `task_library`; show task, step and photo.

### Rules

- `load_index` once at session start (the only network call); after that everything is in-process. Do not load per query.
- **Moss down, degraded, or empty → speak the static instruction.** The coach never goes silent because retrieval broke.
- Never generate a correction from scratch when a retrieved coach phrasing exists. The whole point is that it sounds like her.
- Log every question: `ask_event` (worker, step, question, doc_ids, score, latency_ms, answered_by `moss | static | claude`). The floor and the eval read this.

### Numbers to measure

Retrieval p50/p99, share of questions answered by Moss with no model call, cost per question vs. an all-Claude path, and the false-answer rate on a handful of scripted questions.

---

## 8. Voice (Cartesia)

- **Streaming TTS** for every instruction, cue and correction, so speech starts before the full sentence is generated.
- **Cloned coach voice.** The teammate playing the coach records a short consent statement plus a voice sample. The clone is used only for this worker's guidance. No consent → stock warm voice.
- **Speech input** for "help", "repeat", "what's next", "slower", captured by the DJI Mic Mini transmitters and the receiver on the Pi (§14). Use Cartesia speech-to-text if it's on our plan; otherwise Whisper or browser recognition. Tell the Cartesia judges exactly what they power.
- **Barge-in:** if the worker speaks while the glasses talk, stop speaking and listen.
- **Pacing per worker:** speech rate and pause length stored per worker; "slower" lowers both.
- Ask the Cartesia booth about voice-cloning limits on the hackathon plan and latency tips. Their README requires the features used, known limitations, and no keys in the repo.

---

## 9. SpacetimeDB: the live workplace

One TypeScript module on Maincloud. **Avoid HTTP handlers, views and RLS** (beta/unstable). Procedures with outbound HTTP (`ctx.http.fetch`) are stable since v2.5 and are fine.

**Tables.** `worker`, `coach`, `device` (glasses edge, wrist node, coach phone, buddy phone — one identity each) · `task`, `step`, `checker` (step, version, status `testing | shadow | deployed | retired`, agree_count) · `compile_job`, `compile_event` · `session`, `step_event` (append-only: session, step, tier, status, confidence, latency_ms, cost_usd, ts) · `prompt_event` (what was said, at which support level) · `ask_event` (question, retrieved doc ids, score, latency_ms, answered_by) · `help_request` (status `open | claimed | resolved`, claimed_by, routed_to `buddy | supervisor`) · `mastery` (worker, step, level 0–3, streak, recent_errors) · `presence` (identity, view, last heartbeat) · `consent` (worker/coach, recording, voice clone) · `metric`.

**Reducers.** `register_device`, `publish_task`, `start_session`, `log_verdict`, `advance_step`, `log_prompt`, `log_ask`, `request_help`, `claim_help` (atomic; the second claimer loses and is counted), `resolve_help`, `set_support_level`, `publish_checker`, `record_shadow_result`, `claim_compile_job`, `log_compile_event`, `heartbeat`.

**Scheduled reducers.** Help escalation every 5 s (buddy unanswered 20 s → supervisor); presence expiry every 10 s; mastery recompute at session end; metrics roll-up every second.

**Procedures.** `weekly_report` (calls Claude over HTTP, writes a report row). Fallback is a Node script behind a flag.

**Clients.** The coach floor and buddy page use the TypeScript SDK with live subscriptions. The Python edge app calls reducers through SpacetimeDB's HTTP API.

**What the SpacetimeDB judge sees:** two screens with live cursors; a judge's step changing on the floor instantly; two phones racing to claim one help request with only one winner ("double-claims: 0"); a finished session replaying at 10x from `step_event` rows.

---

## 10. Fading engine

| Level | What the worker gets |
|---|---|
| 0 Full | Full instruction + picture card + "Nice" on success |
| 1 Cue | Short cue only ("Soap, top left") |
| 2 Alerts | Silence unless a mistake is detected |
| 3 Independent | Silence; errors logged for the coach, gentle alert only on repeated errors |

- **Promote** after 3 consecutive correct completions with no correction.
- **Demote** after 2 errors in the last 5 attempts.
- The coach can override any step's level from the floor.
- **Measure it:** prompts per session per step. The "Day 1: 12 prompts → Day 5: 2" curve is simulated and labeled simulated.
- A level change re-indexes that step's guidance in Moss (§7).

## 11. Social layer (Meta)

- **Buddy routing (core-stretch):** "I'm stuck" pages a named coworker buddy's phone first, with the step photo. Supervisor after 20 s. The weekly report notes who helped, so the coach can see relationships forming.
- **Customer reply hints (stretch):** when a customer asks a question, the glasses quietly suggest a short reply. Cut first if time runs out.

## 12. Coach floor (web)

- A card per worker: current step, support level, last verdict with its tier badge, help status.
- Help queue with a claim button.
- Checker panel: Droid's live compile stream and each checker's status (shadow / deployed).
- Search box over `task_library` (Moss), showing the last question answered with its latency.
- Metrics: tier mix, p50/p99 latency, cost per check, false-correction rate, share of questions answered without a model call.
- Replay any session at 10x.

## 13. Weekly report

The `weekly_report` procedure sends a session summary to Claude and stores two versions: a plain-language report for the coach (mastered steps, where support is still needed, help requests, who helped, how often the worker asked questions and got his own coach's words back) and a picture-based version for the worker. This is the Microsoft "measurable usefulness" artifact.

---

## 14. Hardware

This is the confirmed hardware. Don't plan around parts that aren't on this list.

| Part | Purpose | Notes |
|---|---|---|
| Raspberry Pi 5 (8 GB RAM, 64 GB microSD) | Glasses compute: captures camera frames and mic audio and streams both to the edge app | Runs in **USB gadget mode**: one USB-C cable to the laptop is the network link (Ethernet over USB). In bring-up the Pi answered at `10.12.194.1`. Rides on the back strap to balance the camera. **OPEN:** confirm how it is powered in gadget mode and that the mic receiver runs stable on that power (a Pi 5 limits USB peripheral current when it can't get 5 A) |
| OV5647 camera module (CSI, on the Pi 5) | Sees the task | Pi 5 has the 22-pin mini camera connector; the OV5647's stock ribbon is 15-pin, so use a 22-to-15-pin Pi 5 camera cable (30 to 50 cm reaches from the front corner to behind the ear). Capture with **Picamera2**; `cv2.VideoCapture(0)` usually won't see it. Fixed focus, weak in low light: tray 40 to 60 cm away, use the lamp |
| DJI Mic Mini: 2 transmitters + 1 receiver | Voice in: coach narration in teach mode, worker questions and barge-in in coach mode | Receiver plugs into the Pi over USB (verify it appears as a USB audio device in ALSA). Transmitters are clipped on the coach and the worker. **OPEN:** whether the two transmitters arrive as separate channels or one mix, and the recording level. No hardware echo cancellation (see Audio out) |
| Arduino Uno Q + touch sensor | Wrist node: touch = "I'm stuck" / talk request; the built-in LED matrix shows status (help sent, help claimed, step done) | The touch sensor replaces the button: sensor OUT to MCU pin 2, power from 3.3 V, HIGH = touched (the sketch reads pin 2 with no internal pull). Same events as the button, now touch: `DOWN` / `UP`. Connected to the laptop by **USB serial**; its Wi-Fi is not used. No haptics in this build: feedback is the LED matrix plus voice |
| Laptop (MacBook, edge app) | Gating, rectify, checkers, model calls, Moss runtime, Cartesia client, **speaker** | Wired to the Pi (USB-C, gadget) and the Uno Q (USB serial). Uplink for cloud APIs is venue Wi-Fi |
| Power | Pi 5 | Uno Q is powered over its USB serial cable. **OPEN:** Pi 5 power while in gadget mode: laptop cable alone, or a data-only cable plus a separate supply. Test under camera + mic load before the demo |
| Glasses mount + wrist band | Looks wearable | **No 3D prints for the glasses:** generic glasses frame, camera and Pi taped on with duct tape. Camera at the outer front corner, tilted 30 to 40 degrees down. **Wrist band: OPEN** (how the Uno Q and touch sensor are worn; the USB cable to the laptop limits movement) |

**Data paths.** The venue bans phone hotspots, so nothing local is wireless.
- **Pi 5 ↔ laptop:** USB gadget mode (Ethernet over the USB-C cable). The streamer and the mic audio use this link.
- **Uno Q ↔ laptop:** USB serial, 115200 baud, newline-terminated (`DOWN` / `UP` from the Uno, `ACK` / `BUZZ` back). Current bring-up code: `hardware/uno_q`, `hardware/backend`.
- **Laptop ↔ cloud:** venue Wi-Fi (Bitdeer, Claude, Cartesia, SpacetimeDB). Buddy and coach phones reach SpacetimeDB Maincloud over venue Wi-Fi. **Assumption:** venue Wi-Fi is allowed; confirm with the organizers, and preload Moss and checkers so the hot path needs no network.
- **Camera:** start by streaming 640x480 MJPEG at ~15 fps from the Pi to the laptop over the gadget link (measured: 16.3 fps, frame gap p50/p99 62/65 ms). The Pi 5 has headroom to run the motion gate and ArUco rectify on-device; moving them there means only the rectified tray ever leaves the glasses, so do it once the spine works.
- **Mic:** DJI Mic Mini receiver on the Pi; the Pi captures it and streams the audio to the laptop for STT.
- **Wrist node:** touch down starts a timer; release after 1.5 s or more = help request, shorter = talk request. The laptop replies `ACK` on touch down and `BUZZ` when help is sent. Help and talk requests go on to the edge app and the `request_help` reducer. LED patterns for *help claimed* and *step done* are still to build.
- **Audio out:** the **MacBook speaker**. Cartesia streaming TTS plays on the laptop as it arrives, with captions on screen. Nothing plays on the glasses.
- **Barge-in without echo cancellation, OPEN:** the speaker is separate from the worker's microphone, and speaker sound can leak into the transmitters. Test it at the table and gate barge-in (for example, only react to speech well above the speaker's level while TTS plays).

**Fallback.** The OV5647 is CSI and can't plug into the laptop. If the gadget link or the Pi stream fails at judging (replug the USB-C cable first), plug a USB webcam into the laptop or play the backup video.

Wiring: jumper wires only, no soldering at the venue.

**Props:** generic glasses with the camera taped on; a tray with 4 printed ArUco markers on its corners and 4 marked slots; a blue soap bar, green shampoo bottle, yellow lotion, white washcloth. Steps: soap → slot A, shampoo → slot B, lotion → slot C, fold washcloth into slot D (no checker — this is where the cascade escalates), slide tray to the "done" mark.

---

## 15. Responsible design (do not trade away)

- **Only the work surface leaves the device.** Cloud models see the rectified tray image, never faces or the room. No video stored; only step reference photos, with consent.
- **Consent first.** A recorded consent statement before any voice clone; the worker controls on/off.
- **Dignity.** Encouraging language, no nagging (rate limits in §6), silence when unsure.
- **Human in the loop.** Help always reaches a person. The AI never decides discipline or performance reviews.
- **Local memory.** Guidance history is queried in-process (§7) and does not leave the laptop.
- **Language.** "People with intellectual and developmental disabilities" — capable workers who need support.

---

## 16. Eval harness

Friday night, record ~40 labeled clips of the amenity task: correct runs plus three mistake types (wrong slot, missing item, wrong item). A script runs every tier over every clip and outputs:

- precision and recall per tier, and **false-correction rate** (telling someone they're wrong when they're right — the number that matters most)
- p50/p99 latency per tier
- cost per check per tier, and per full task
- share of steps covered by deployed checkers
- Bitdeer model comparison (at least two catalog vision models)
- Moss: retrieval p50/p99, share of scripted questions answered without a model call, false-answer rate

Quote only measured numbers, at judging and in the README.

---

## 17. Sponsor load-bearing check

If a row's last column isn't true in the running product, that sponsor isn't load-bearing yet. Fix the product, not the table.

| Sponsor | Its job | Features used | Remove it and… |
|---|---|---|---|
| Cartesia | The coach's voice | Streaming TTS, voice cloning, STT if on our plan | The worker hears nothing, or hears a stranger |
| Bitdeer | Checker for anything not compiled | Vision models via OpenAI-compatible API (`base_url="https://api-inference.bitdeer.ai/v1"`) | Every uncompiled step goes to Claude: slower and costlier |
| SpacetimeDB | The workplace's shared state | Tables, reducers, scheduled reducers, procedures with outbound HTTP, live subscriptions, one identity per device | No live floor, no help routing, no replay, no mastery state |
| Claude | The teacher and the judge | Vision + structured output for the task spec, disagreement calls, weekly report | No task can be taught; disagreements go unresolved |
| Factory Droid | The checker engineer | Droid SDK sessions in a git worktree, medium autonomy, streamed events | No millisecond tier; every check needs a model call |
| Moss | The worker's memory | Indexes per worker + task library, hybrid query, metadata filtering, in-process runtime | Every question costs a model round trip and the coach's own wording is lost |

### Correlation warning

Cartesia, Bitdeer, Anthropic and the general prizes all ride on one live moment: the judge wearing the glasses and getting checked correctly. If vision checking is flaky at the table, most tracks fall together. SpacetimeDB, Factory and Moss are the most independent (floor, compile step and the question path can each be shown on their own).

### Prize strategy

| Tier | Track | Fit | What wins it |
|---|---|---|---|
| Core | Cartesia | Strong | Voice is the whole interface; coach's cloned voice; accessibility + privacy built in |
| Core | Bitdeer Model Studio | Strong | Middle tier of every check + a published model comparison |
| Core | SpacetimeDB | Strong | Live floor: every worker's step streaming, help claimed once, session replay |
| Core | Anthropic | Strong if we talk to a real coach | Teach mode, disagreement calls, weekly report, honest failure modes |
| Core | Factory Droid SDK | Medium (ambitious) | Droid compiles a checker per step on a trigger we designed, sandboxed, plans and diffs visible |
| Core | Moss | Strong (confirm track + prize at the booth) | Sub-10 ms guidance retrieval in-process: the worker's own coach answering instantly, privately, offline |
| Stretch | Meta: Bringing People Closer Together | Medium | Buddy routing pulls a coworker in instead of a remote screen |
| General | Cal Hacks People-First, Best Hardware, Most Technically Complex, overall | Strong | Judge wears it; three-tier cascade with measured numbers |
| Free | Microsoft Grand Prize + Customer Impact Award | Low effort | README: measured usefulness, path to production, responsible design |
| Free | MLH Gen AI, Backboard, Notability | Low effort | Opt in; one teammate keeps Notability build notes all weekend |

---

## 18. Demo (2 minutes)

1. **0:00 Hook (15 s).** "Jordan's job coach visits twice a week. The other three days, small mistakes add up."
2. **0:15 Teach (20 s).** A teammate (as the coach) sets up the tray once while narrating. Steps with photos appear; Droid's plan and test results stream onto the floor as it compiles checkers.
3. **0:35 Coach (35 s).** The judge wears the glasses and hears the coach's voice. The floor shows each check's tier lighting up: checker → Bitdeer → Claude on the fold step. The judge asks "what now?" and gets the coach's exact words back in single-digit milliseconds, with the latency on screen.
4. **1:10 Catch (15 s).** The judge puts the lotion in the wrong slot and gets a gentle correction.
5. **1:25 Help (15 s).** The judge touches and holds the wrist sensor; a teammate's phone (the buddy) claims it on the live floor.
6. **1:40 Proof (15 s).** The tier chart (latency, cost, false-correction rate) and the fading curve (labeled simulated).
7. **1:55 Close (5 s).** "Support that builds independence, not dependence."

**Judge slices (20 s each):**

| Judge from | Their 20 seconds |
|---|---|
| Cartesia | The cloned voice, barge-in, "slower", and the consent flow |
| Bitdeer | The model comparison table; a live Bitdeer check with its latency on screen |
| SpacetimeDB | Two screens, live cursors, the help-claim race (double-claims: 0), replay at 10x |
| Factory | Teach a new step live; Droid's plan, diff and held-out test run stream in; shadow → deployed |
| Anthropic | The task spec Claude wrote, a disagreement Claude settled, and where it fails |
| Moss | Ask three questions; each answer is the coach's own phrasing, sub-10 ms, with the network monitor showing no call |
| Meta | Buddy routing and the weekly "who helped" note |
| Microsoft | Prompts per task over time, cost per check, the path to supported-employment programs |

Record the full demo Saturday night as the fallback video.

---

## 19. Build plan

The spine (camera → rectify → Bitdeer check → voice → floor) is done by Saturday 6 AM. A missed gate cuts scope from the stretch tier, never from the spine.

**Foundation — Fri 6–10 PM.** First 2 hours, kill-test the unknowns: camera frames into the laptop; ArUco detection on the printed tray; one Bitdeer vision call with timing; Cartesia streaming TTS and a voice clone; SpacetimeDB module published, a reducer called from Python, a procedure making an outbound call; Droid SDK running in a worktree; **Moss index created and queried from Python with the index preloaded**. Schema written and frozen. **Gate (10 PM):** a scripted step event shows on the floor, one instruction plays through the audio out, and a scripted question returns the right guidance line in <10 ms.

**Core — Fri 10 PM → Sat 6 AM.** Teach mode → `TaskSpec`; coach loop with Bitdeer + Claude escalation, debounce rules, voice guidance; wrist touch (help) → floor; question path (Moss with static fallback); record the ~40 eval clips. **Gate (6 AM):** a full run of the amenity task end to end, Bitdeer-only.

**Upgrades — Sat 6 AM → 2 PM.** Droid checker compiler with held-out tests and shadow promotion; Uno Q wrist node (touch + LED matrix status); buddy routing; fading engine; eval harness producing the numbers; tape up the glasses mount and decide the wrist band. **Gate (2 PM):** full demo with all three tiers.

**Second tier — Sat 2 → 10 PM.** Replay, weekly report procedure, Bitdeer model comparison, Moss task-library search on the floor, customer reply hints (stretch). Test with someone outside the team. **Gate (10 PM):** feature freeze.

**Polish — Sat 10 PM → Sun 8 AM.** Fallback video; README with a section per sponsor; measured numbers; what's real vs simulated. Rehearse the 2-minute core and every slice 10 times. Sleep a few hours. Submit by 8 AM (Devpost closes 9 AM).

## 20. Team split

| Person | Owns |
|---|---|
| 1 | Hardware: Pi 5 + OV5647 camera mount, DJI Mic Mini on the Pi, Uno Q wrist node (touch), tray props, glasses tape mount, wrist band |
| 2 | Teach mode (Claude) + Droid checker compiler + helper library |
| 3 | Coach loop cascade, Bitdeer, Moss question path, eval harness, latency/cost logging |
| 4 | Cartesia voice + cloning, SpacetimeDB module + floor, pitch, README, video |

## 21. Cut order

Cut in this order: customer reply hints → buddy routing (keep plain supervisor alert) → weekly report → replay → Moss question path (keep floor search and static prompts) → Droid checkers (cascade becomes Bitdeer → Claude).

Never cut: step checking, the coach's voice, the live floor, the eval numbers.

## 22. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Vision checks flaky in a loud, crowded venue | ArUco rectification + debounce; demo task chosen for visually distinct right/wrong; stay silent when unsure |
| Bitdeer too slow | Measure Friday; use the fastest catalog model; more steps go to compiled checkers |
| Droid can't produce passing checkers in time | Bitdeer → Claude cascade; show a recorded Droid session |
| Voice clone not allowed on our plan | Stock warm voice; say so in the README |
| Moss index won't load offline at the venue | Preload before the demo, on whatever network we have; fall back to static `TaskSpec` instructions (product still works) |
| Moss free-tier limits (index size, query volume) | Index only `guidance_<worker>` for the demo worker plus one task library |
| SpacetimeDB procedure or Maincloud issue | Node worker behind a flag; the hot path never depends on the database |
| Phone hotspots banned at the venue | Pi in USB gadget mode and Uno Q on USB serial, so no local wireless; the laptop uses venue Wi-Fi for cloud only; checkers and Moss run offline |
| USB-C gadget link or Uno serial cable unplugged or flaky | Short, strain-relieved cables; replug; backup video |
| Pi 5 camera stream fails at the table | USB webcam into the laptop (the OV5647 is CSI and can't plug in), or the backup video |
| Wrong camera cable (Pi 5 needs 22-pin to 15-pin) | Ask both hardware desks Friday for a Pi 5 camera cable plus a spare; fallback is a cap mount with the Pi close to the camera |
| No real job coach quote | Say what we learned and from whom; never invent a quote |
| Judges think "seen it" | Open with teach-once + the coach's voice, not "glasses that guide you" |

## 23. Booth questions (Friday night)

- **Cartesia:** voice cloning on the hackathon plan; speech-to-text availability; latency tips.
- **Bitdeer:** fastest vision model in the catalog; rate limits; whether a cascade with other models counts as strong Model Studio use.
- **SpacetimeDB:** procedure stability on Maincloud this weekend; HTTP API rate limits.
- **Factory:** credits; how they want Droid's work shown in the README.
- **Moss:** free-tier index size and query volume; whether queries stay local once the index is loaded (we claim this publicly); cloning/updating an index mid-session; how they want usage shown.
- **Meta:** whether a non-Meta wearable fits their track.
- **Anthropic:** judging format and the prize.

## 24. Before kickoff (only humans can do these)

- [ ] Reach one job coach, special-ed teacher or supported-employment program tonight; get a real quote
- [ ] Accounts and keys: Anthropic, Bitdeer (Console → Models → API Keys), Cartesia, Factory, SpacetimeDB, Moss (`project_id` + `project_key`)
- [ ] Buy props: tray, blue soap, green shampoo, yellow lotion, white washcloth; print 4 ArUco markers
- [ ] Get a Pi 5 camera cable (22-pin to 15-pin, 30 to 50 cm) plus a spare, jumper wires, and a USB webcam as the camera fallback
- [ ] Bring: Pi 5 + 64 GB microSD (Raspberry Pi OS flashed, gadget mode on), OV5647, DJI Mic Mini (2 transmitters + receiver), Uno Q + touch sensor, USB-C and USB cables long enough for the wearer to move, duct tape, a generic glasses frame
- [ ] Record the teammate-coach's consent statement and voice sample

## 25. README requirements by sponsor

- **Cartesia:** setup, features used, known limitations, no keys in the repo; 2-minute demo-first video.
- **Bitdeer:** how Model Studio is used and why; the model comparison table.
- **Factory:** where and how Droid runs, its trigger, its permissions, a link to a recorded session.
- **SpacetimeDB:** tables, reducers, scheduled jobs, the claim-race result, replay.
- **Moss:** what is indexed, query paths, measured retrieval latency and no-model-call share, why retrieval is local.
- **Anthropic:** the named community, what we learned from a real person, where Claude can fail.
- **Microsoft:** measured usefulness, path to production, responsible design.

---

## 26. Working conventions for agents

- Python for the edge app (checkers, cascade, Moss, Cartesia client) and the Pi 5 camera and mic streamers (Picamera2, audio); an Arduino sketch for the Uno Q wrist node's MCU side; TypeScript for the SpacetimeDB module and the floor; do not introduce a second language for either job.
- Keep the hot path synchronous and dependency-light. Anything that can block (model calls, reducer writes, indexing) goes off the frame loop.
- Every new verdict field, table or index gets added to the schemas above *and* to the eval/logging path in the same change.
- Write the debounce, claim-race and Moss-fallback behavior as tests. They are the product.
- Simulated data is fine; unlabeled simulated data is not.
- When a sponsor feature breaks, degrade to the next tier and label it on screen. Silence is always better than a wrong correction.
