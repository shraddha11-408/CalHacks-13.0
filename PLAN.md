# Stepwise — Team Plan (MVP)

> **This is the build plan.** It supersedes AGENTS.md wherever they disagree (see the
> "MVP decision record" at the top of AGENTS.md). Adaptations for the keys we have are
> marked **[adapted]**.

Cal Hacks 13.0 · Submission due Sunday 9:00 AM · Judging Sunday 10:30 AM – 12:30 PM (everyone at the table)

## What we're building

**Problem:** Many people with intellectual and developmental disabilities can work, but job coaches are too expensive and too scarce, so small, fixable mistakes cost them jobs.

**Solution:** Glasses that learn a task by watching a supervisor do it once, then coach the worker step by step: they check each step with the camera, gently correct mistakes, answer questions by voice, remember each person's past mistakes, and call the supervisor when the worker needs help.

**Demo task:** folding a towel the "hotel way." One task, done perfectly.

## How it works (end to end)

### 1. Teach (once per task)
- Supervisor wears the glasses and does the task once. Recording is on.
- The app pulls 8–20 key frames (moments the hands pause between steps), blurs faces, and saves only those frames as reference photos. The raw video is deleted after the steps are created. **[adapted]** The browser never records video at all: it keeps only the key frames, face-blurred, so there is nothing to delete.
- Claude looks at the key frames in order and writes the step list.
- Supervisor reviews and edits the steps on the dashboard, then saves.
- Cartesia pre-records every instruction and correction, so playback is instant.

Step list format (saved in **SpacetimeDB** **[adapted: was Convex]**):

```json
{"steps": [
  {"id": 1,
   "instruction": "Lay the towel flat on the table.",
   "done_right": "Towel fully flat, long side toward the worker.",
   "common_mistake": "Towel bunched up.",
   "correction": "Smooth it out so it's flat.",
   "why": "A flat towel folds evenly.",
   "reference_photo": "file_id"}
]}
```
**[adapted]** `why` is added so "Why?" is answered instantly with no model call.

### 2. Coach (worker wears the glasses)
- The worker's video is never stored.
- The laptop watches every frame with fast, local tracking (MediaPipe hands + motion). That's the real-time layer.
- It sends one snapshot to the vision model only at the moments that matter (triggers below). That's the judgment layer.
- Before each step, the app asks Moss for relevant memories about this worker and adjusts the instruction ("Last time the corners got bunched, so smooth them out first").

| Trigger | How it's detected |
|---|---|
| Hands pause ~0.8 s | MediaPipe hand movement below threshold for ~8 frames |
| Hands leave the work area | Hands no longer in the table region |
| Worker says "done" or "is this correct?" | Voice (push-to-talk) |
| Timeout | No check for ~8 s |

What happens to a snapshot:
1. Pick the sharpest frame from the pause, crop to the work area, blur faces, resize to ~512 px.
2. Send it to the Bitdeer vision model with the step's reference photo, done_right, and common_mistake.
3. Ignore new triggers until the answer comes back (~1–2 s).
4. Act on the answer:
   - done → "Great!" + next instruction
   - mistake → play correction, keep watching, log the mistake (SpacetimeDB) and save a memory note (Moss)
   - in_progress → keep watching quietly
   - unclear or low confidence twice → ask Claude with the last 3 frames

Optional upgrade (not in MVP): for steps where order matters, send the last 2–3 s as a short clip.

### 3. Talk (worker asks the glasses)
Worker presses push-to-talk and speaks. **[adapted]** Nemotron Omni isn't in our Bitdeer catalog, so: audio → Cartesia speech-to-text → intent → answer → Cartesia speaks it.

| Worker says | What happens |
|---|---|
| "Is this correct?" / "done" | Immediate check of the current step |
| "What's next?" / "Say that again" | Instant, no model call |
| "Why?" | Explains the reason for the step (instant, from `why`) |
| "Help" / "I'm stuck" | Supervisor alert |
| Anything else | Claude answers with the frame + task context |

If a reply takes over a second, play "Let me look…" first.

### 4. Help (anytime)
- Button: short press = talk, long press = help. **[adapted]** On-screen button + spacebar until the ESP32 button exists.
- Help → alert with the current photo goes to the supervisor dashboard (SpacetimeDB, real time) → Cartesia says "Okay, I've let your supervisor know. Help is coming."
- The button always works, even if voice doesn't.

### 5. Remember (between sessions)
| Layer | Tool | Stores | Used for |
|---|---|---|---|
| Event log | SpacetimeDB **[adapted]** | Every step, mistake, check, help request (worker, task, step, time, latency) | Dashboard, progress charts |
| Personal memory | Moss | Plain-language notes: "Jordan bunches the corners," "does better with picture cues" | Warnings and personalized instructions next time, even on new tasks |

## Sponsor tracks (MVP)
| Track | Used for |
|---|---|
| Anthropic (Claude) | Teach mode (step list), unclear checks, open questions |
| Bitdeer AI Model Studio | Every step check |
| Cartesia | All spoken guidance, corrections, answers; speech-to-text for push-to-talk |
| Moss | Personal memory of each worker's mistakes and preferences |
| SpacetimeDB **[adapted]** | Database, real-time supervisor dashboard |
| Skipped (no key / later) | Convex, Nemotron Omni, Factory, Apify, Notability |

## Team rules
- One demo task. Make it perfect before adding anything.
- USB camera + phone hotspot. Never depend on venue Wi-Fi.
- The demo never freezes. If a model is slow or down, saying "done" or pressing the button moves to the next step.
- Privacy: faces blurred, no video stored, only reference photos and alert photos.
- Language: "people with intellectual and developmental disabilities." Capable workers who need support.
- Not in the MVP: fading support, Factory nightly report, Apify job matcher, paycheck coach.
