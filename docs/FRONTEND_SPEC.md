# drigil — Frontend spec (page architecture + UX)

*Owner: product design · 2026-10-24 · Source of truth for the web UI rebuild. Supersedes the stone rules in
[UI_GUIDE.md](UI_GUIDE.md) §1, §5.1–5.3, §7–8 (stones). Palette, type, copy voice and Sol rule from UI_GUIDE stay.*

**Five decisions**
1. **Light only.** One cream canvas everywhere; Río (dark teal) only for the landing hero band and the buddy help screen.
2. **One shell** (`SiteHeader` + `SiteFooter`) on every page, including /lab routes. No black app bar, no lavender.
3. **Stones are the logo only.** Everywhere else: photo step timeline, worded support-level chips, real data cards.
4. **Landing tells the story in 7 sections** with an HTML/CSS product mock, not a metaphor diagram. New **/why** page maps research → features.
5. **Strict file ownership** across 3 builder packages (§7); only A edits tokens, Brand, shell.

---

## 1. Audit (what is broken today)

**Global**
- `tokens.css` still has a `prefers-color-scheme: dark` block + `[data-theme=dark]`: on dark-mode Macs inputs render black (`#1a1a1d`) on cream and accents turn lavender (`Go`, `Start getting alerts`, `/buddy` link, logo "d" chip). Two token systems (`tokens.css` + `piedra.css`) fight; `idd.css`/`app.css` add a third.
- Header is the old black `app-bar` (`#111`) with a purple-highlighted "d" in the wordmark; height 76 px; no nav, only "← Back"/"← Home". Every page above the fold reads as a different product.
- Fonts: Atkinson Hyperlegible is still imported and wins on some buttons; display headings mix Bricolage 600/800.
- Inline links render as flex children (`the help buddy page` floats 14 px above its sentence on Home and Choose).
- Emoji in buttons (🔊 📷 📹 ✋ ▶) — off-brand next to the mono/grotesk system.
- No footer anywhere; pages end abruptly with 60–70 % empty viewport.

**/ (Home)**
- Two designs stacked: black app bar + a 44 px cream gap + Río hero. Hero does not touch the header.
- Stone labels (`1 · teach`, `2 · coach`, `3 · own`) float detached from stones; the Sol stone is clipped by the hero top edge; an empty outline ellipse reads as a bug.
- Light legend card (`Stone size = help…`) sits on the dark hero, low contrast (rio-muted on card).
- Copy explains the metaphor ("path of stones across the river") instead of the product. Never says glasses, coach, voice, worker.
- Below the hero: "Start here" + 3 pills (`Continue` is ambiguous) + one note card, then ~1000 px of nothing. No how-it-works, proof, audience, privacy or CTA.

**/choose**
- Card titles `I'm a worker` / `I'm a supervisor` are near-invisible (light text on light card, ~1.1:1).
- Cards have heavy drop shadow + borders unlike all other cards. No icon/visual; buddy is a footnote not a third choice.

**/worker (name)**
- Black input, lavender disabled `Go` button, focus ring lavender. Page is a lone form with no context (who is this for, what happens next).
- After name: task list uses `wk-display` heading, but no photo/preview of each task.

**/worker/:taskId**
- Overview: `StonePath` + `StoneLegend` duplicates the step list right below it; stone size ≠ obvious meaning to a worker.
- Running: step stones on top, instruction mid-page, reference photo in a side column; help button sits among 5 equal-weight buttons (Hear it, Back, Next, Help, End) — Sol button not dominant, End task too easy to hit.
- `LevelBadge` text ("Short cue") is supervisor language shown to the worker.
- Mistake log title in mono eyebrow style; "Things to fix" reads as blame.

**/supervisor**
- Active tab label is white on cream (invisible: "Help alerts"). Tab underline is full-width black 1 px — heavy.
- Title "Supervisor" names the role, not the job. Eyebrow `DRIGIL · COACH FLOOR` and title disagree.
- Help tab empty state is a dashed box; live worker cards (`sv-floor`) only appear when a session is live, so the default view is almost empty.
- `/buddy` link is lavender; `double-claims: 0` badge is black pill developer jargon on the main screen.
- Worker cards use `StonePath` + legend: supervisor can't read levels without decoding sizes.

**/buddy**
- Name form identical to worker's (black input, lavender button). Heading "Your name (help buddy)" — parenthetical.
- Waiting/help states are fine in spirit (Río screen) but are not framed as a phone.

**/steps, /lab, /video, /teach, /coach, /health**
- Use the old `Layout` (dark dev shell, Atkinson). Fine as lab pages but must share the new header.

---

## 2. Global shell

**Theme.** Light only. Package A deletes the dark blocks in `tokens.css` and sets `color-scheme: light`. Old
token names stay mapped to Piedra values (piedra.css already does this) so lab pages inherit.

**SiteHeader** (`web/src/components/SiteHeader.tsx`, used by `AppShell` and `Layout`)
```
| [icon] drigil      How it works   Why it works   For supervisors        [Open drigil ▸] |
```
- 64 px tall, `--cream` bg at 92 % + `backdrop-filter: blur(12px)`, hairline bottom `--line`, sticky.
- Brand: `AppIcon` 24 px + wordmark Bricolage 800 22 px `--pizarra`. No colored chip on any letter.
- Nav (Onest 500 15 px, `--ink-muted`, active = `--pizarra` + 2 px Río underline): `How it works` (/#how),
  `Why it works` (/why), `For supervisors` (/supervisor).
- Role-aware CTA (right): on `/`, `/why` → `Open drigil` (Río pill → /choose). Inside `/worker*` → shows the worker's
  name chip (`Jordan ▾`, menu: "Not Jordan? Change name"). Inside `/supervisor` → `Open buddy phone` outline pill.
  Inside `/buddy` → header collapses to brand only (phone context).
- **Worker running mode** (`phase==='running'`): header shrinks to brand + task title; nav hidden (focus).
- 390 px: nav collapses into a `Menu` text button opening a full-width sheet; CTA stays visible.

**SiteFooter** — only on `/`, `/why`, `/choose`: three columns (Product: How it works, Why it works · Use it:
Worker, Supervisor, Buddy phone · Built at Cal Hacks 13.0, privacy line "Faces are blurred before any frame leaves the
browser. No video is stored."). Bottom row mono caption `drigil · little steps to independence`. Lab links
(`/lab`, `/health`) appear here only, in `--ink-muted` 13 px.

**Layout.** Container `max-width: 1120px`, side gutter 24 px (16 px ≤ 480 px). Reading width 680 px. 12-col grid,
24 px gap; collapse to 1 col ≤ 768 px. Section rhythm: 96 px vertical desktop, 56 px mobile; eyebrow → h2 gap 12,
h2 → lede 16, lede → content 40. App pages (worker/supervisor) use 32 px top padding, not section rhythm.

**Type scale.** Display h1 56/1.05 landing, 40 app; h2 36 landing, 28 app; h3 20 Onest 600. Body 17. Remove Atkinson
imports from `main.tsx`.

**Cards.** `.card` = `--card` bg, radius 20, 1 px `--line` border, shadow `0 1px 2px rgba(15,59,58,.06)`; hover
(clickable only) lifts to UI_GUIDE shadow. No dashed boxes. `.card-dark` = Río bg, cream text (hero mock, buddy).

**Buttons.** Height 48 (56 for worker `xl`), pill, Onest 600 16.
- `btn-primary`: Río bg, cream text. One per view.
- `btn-outline`: transparent, 1.5 px `--pizarra` 30 % border, Pizarra text.
- `btn-ghost`: text only, underline on hover.
- `btn-sol`: Sol bg, Pizarra text, 1.5 px Pizarra 20 % border. **Only** "I need help" (worker) and "I'll help" (buddy).
- Disabled: 45 % opacity of the same variant (never lavender). Focus: 3 px Río ring at 35 % + 2 px offset.
- Icons: inline SVG 20 px (Lucide-style strokes), no emoji.

**Inputs.** Cream-white `#FFFDF9` bg, 1.5 px `--line` border → Río on focus, radius 14, height 56, Onest 18.

**States** (shared components in `components/States.tsx`, package A):
- `EmptyState` — 48 px line icon, h3, one sentence, optional action. e.g. "No one needs help right now." / "You'll see a
  card here the moment someone asks."
- `Loading` — skeleton blocks in `--line` with 1.2 s shimmer (static under reduced motion). Never "Loading…" text alone.
- `ErrorNote` — card with Almost-tone copy: "We couldn't reach the coach server. Try again." + retry button. Never red;
  use Pizarra text with a 4 px Sol left rule only if a person must act, else Piedra rule.

**Mobile 390 px.** Every page single column; tap targets ≥ 48; worker run screen stacks camera → instruction → help
bar fixed to bottom (safe-area padding); supervisor tabs become a horizontal scroll segmented control; no horizontal
page scroll.

---

## 3. Sitemap + routes

| Route | Page | Status |
|---|---|---|
| `/` | Landing | rebuild (A) |
| `/why` | Why it works (research → features) | **new** (A) |
| `/choose` | Who is using drigil? | restyle (A) |
| `/worker`, `/worker/:taskId` | Worker name → tasks → overview → run → finish | restyle (B) |
| `/supervisor?tab=floor\|help\|add\|report` | Coach dashboard | restyle + new `floor` tab default (C) |
| `/buddy` | Buddy phone | restyle (C) |
| `/steps`, `/steps/:taskId`, `/lab`, `/video`, `/teach`, `/coach`, `/health` | Lab | keep; new header via `Layout`; footer link only |
| `*` | → Landing | keep |

---

## 4. Pages

### 4.1 `/` Landing (A)
```
┌ SiteHeader ───────────────────────────────────────────────────────────────┐
├ HERO (Río band, full-bleed, 88vh max 760) ────────────────────────────────┤
│ JOB COACH IN YOUR GLASSES                 ┌ GlassesMock (card-dark) ─────┐│
│ Taught once.                              │ [camera frame w/ photo]      ││
│ Coached every step.                       │  STEP 2 OF 4 ▸ chip "Now"    ││
│ drigil turns one recorded demo from a     │  ┌ CorrectionBubble ───────┐ ││
│ job coach into step-by-step coaching in   │  │ ◉ Maya's voice          │ ││
│ smart glasses — in the coach's own voice. │  │ "Almost. Turn the sleeve│ ││
│ [Open drigil]  [See how it works]         │  │  so the words read up." │ ││
│ ● Faces blurred in the browser · No video │  └─────────────────────────┘ ││
│   stored                                  │  StepTimeline (4 thumbs)     ││
│                                           └──────────────────────────────┘│
├ PROBLEM STRIP (cream) ────────────────────────────────────────────────────┤
│ 3 StatCards: [stat] + label + source chip  (from IDD_RESEARCH.md)         │
├ HOW IT WORKS  id="how" ───────────────────────────────────────────────────┤
│ 01 Teach once   02 Coach live   03 Fade support   04 Help is one tap      │
│ (4 FeatureSteps, each with a mini UI vignette)                            │
├ TWO AUDIENCES ────────────────────────────────────────────────────────────┤
│ [For workers card]                  [For job coaches & supervisors card]  │
├ PRINCIPLES (privacy + dignity), 4-up ─────────────────────────────────────┤
├ RESEARCH TEASER → /why ───────────────────────────────────────────────────┤
├ CTA band (card, not full Río) ────────────────────────────────────────────┤
└ SiteFooter ───────────────────────────────────────────────────────────────┘
```
Copy:
- Hero h1 `Taught once. Coached every step.` · lede as drawn · CTAs `Open drigil` (primary, cream-on-Río variant:
  cream bg, Río text) / `See how it works` (outline cream 40 %). Trust line mono 13 rio-muted.
- `GlassesMock`: pure HTML/CSS. Frame image = a real step `reference_photo` from `api.tasks()` → first task, step 2
  (fallback: CSS gradient + "SAMPLE" eyebrow). Bubble text = that step's `correction` field (fallback: the hardcoded
  line above). Voice name = `task.voice.name` or "Coach". Label `SAMPLE ·` if data is fallback.
- Problem strip eyebrow `THE GAP`; h2 `Job coaches can't be there every day.`; three `StatCard`s with slots
  `{stat, label, source}` filled from `docs/IDD_RESEARCH.md` (employment rate of adults with IDD; typical job-coach
  visit frequency / fading of coach hours; one outcome stat for systematic instruction). Until filled, render
  `—` and the label; never ship invented numbers.
- How it works h2 `From one demo to a worker on their own.`
  - 01 `Teach once` — "A coach records the task while talking. Claude writes the steps, photos and likely mistakes."
    Vignette: 3 step rows with thumbnails.
  - 02 `Coach live` — "A vision model checks each step as the worker moves. Corrections come in the coach's own
    cloned voice, and start with 'Almost.'" Vignette: CorrectionBubble.
  - 03 `Fade support` — "Each step gets less help as the worker masters it: full instruction, short cue, alerts only,
    on their own." Vignette: SupportMeter row ×4 levels.
  - 04 `Help is one tap` — "'I need help' pages a coworker buddy first, then the supervisor after 20 seconds." Vignette:
    mini buddy phone with Sol button.
- Audiences: `For workers` — "Big photos. One step at a time. Ask out loud: 'Is this right?'" → `I'm a worker`.
  `For job coaches` — "See who is on which step, who needs help, and which steps are getting easier." → `Open the
  coach floor`.
- Principles h2 `Built for dignity.` 4 cards: `Faces never leave the browser` · `No video is stored` · `Never "wrong."
  Always "Almost."` · `A person is always one tap away`. Each 1 sentence.
- Research teaser: h2 `Built on how job coaches already teach.` 5 method chips (Task analysis · Systematic instruction
  · Prompt fading · Video modeling · Natural supports) → `Read the research` (/why).
- CTA: h2 `Try it with your webcam.` sub "The laptop camera stands in for the glasses." `Open drigil`.

### 4.2 `/why` Why it works (A)
Reading layout (680 px) with sticky left TOC ≥ 1024 px.
1. Eyebrow `WHY IT WORKS` · h1 `Support that builds independence.` · lede: one paragraph on the IDD employment gap.
2. `The problem` — 2–3 paragraphs + 2 StatCards (from IDD_RESEARCH.md).
3. `What the research says works` — `MethodRow` ×5. Anatomy: method name (h3) · "What it is" (1–2 sentences) ·
   "In drigil" (feature + link to screen) · source chips `[1]`. Mapping:
   - Task analysis → Teach once: Claude splits the demo into steps with photos, success criteria, common mistakes.
   - Systematic instruction (least-to-most / most-to-least prompting) → live check + correction only when needed.
   - Prompt fading → support levels 0–3 per step, promote after 3 clean runs, step back after 2 errors in 5.
   - Video modeling → reference photo per step ("Done right looks like this"), coach's narrated demo.
   - Natural supports → buddy routing: coworker first, supervisor after 20 s.
4. `What drigil doesn't do` — no discipline/performance decisions; silence when unsure; simulated data labeled.
5. `Sources` — numbered list, exactly as in IDD_RESEARCH.md (author, year, title, link). Mono numbers.

### 4.3 `/choose` (A)
h1 `Who is using drigil?` Three equal `RoleCard`s (icon, h3, 1 line, arrow): `I'm a worker` "See my tasks. Get help step
by step." · `I'm a supervisor` "Help alerts, new tasks, worker progress." · `I'm a help buddy` "Get a ping when a
coworker needs a hand." Fix contrast: titles Pizarra 24 px.

### 4.4 `/worker` flow (B) — first-grade copy, worker-facing
- **Name:** h1 `Hi! What is your name?` input `Your name` · `btn-primary xl` `Start`. Caption "Your coach set up your
  tasks." (Remembered name → skip to tasks with `Not {name}? Change`.)
- **Tasks:** h1 `Hi, {name}.` sub `Pick a task.` Grid of `TaskCard`s: first step `reference_photo` (16:10), title,
  `{n} steps`, `SupportSummary` ("3 of 4 steps on your own" from `WorkerFading` levels; omit if none). Data: `api.tasks()`.
- **Overview** `/worker/:taskId`: eyebrow `{n} STEPS` · h1 `{task.title}` · `Look at the steps. Then press Start.` ·
  `StepTimeline` vertical (photo 120 px, `Step k`, instruction, `Hear it` ghost button). Worker-facing level words
  (from `LEVELS[].worker`: Learning / Short reminders / Only if needed / On your own) as a `SupportChip`.
  Video stand-in picker becomes a small ghost link under Start: `Use a video instead`. Primary `Start task`.
- **Run** (2-col ≥ 1024: camera 7 cols, guidance 5 cols; stacked on mobile):
```
┌ camera (LiveCheck, face-blurred) ───────┐ ┌ STEP 2 OF 4 · [Now] ──────────┐
│                                         │ │ Slide the sleeve onto the cup.│ (Display 32)
│  CorrectionBubble overlays bottom-left  │ │ [ref photo] Done right looks  │
│  when a correction is spoken            │ │             like this.        │
└─────────────────────────────────────────┘ │ MicChip  "Try: Is this right?"│
 StepTimeline horizontal (thumbs, Now ring) │ chat (last 2)                 │
                                            └───────────────────────────────┘
 Bottom bar: [Hear it] [← Back] [Next →]          [✋ I need help (Sol, 56px)]
 "End task" = ghost link in header area, confirm dialog "Stop this task?"
```
  Help sent → button becomes cream `Help is coming. {buddy} is on the way.` (from `api.help` result if available,
  else "Help is coming.").
- **Finish:** h1 `You finished! Great work.` · `StepTimeline` all done · level-ups list ("Step 2: now Short
  reminders") · mistake log renamed `Things we practiced` with each `correction` text (no counts in red) · buttons
  `Do it again` / `My tasks`.

### 4.5 `/supervisor` coach dashboard (C) — professional copy
Header h1 `Coach floor` · sub `Live view of your workers, help requests and progress.` Tabs (segmented, Río active
fill, cream text): `Floor` (default, new) · `Help` (badge with open count, Sol dot if > 0) · `Add a task` · `Reports`.
- **Floor:** grid of `WorkerCard`s (data: `session` live rows, `worker`, `mastery`, `talkEvent`, `step` lookup).
  Anatomy: name h3 · task title · `STEP n OF m` mono · `StepTimeline` compact (thumb 40 px) · per-step `SupportMeter`
  with words · last "Heard" quote · `Needs help` Sol banner when an open `helpRequest` exists. Empty: EmptyState
  "No one is working right now." + "Workers appear here when they start a task."
- **Help:** list of `HelpCard` (worker, step, photo, `ago`, routed_to buddy/supervisor, claimed by). Sol left rule
  for open. `double-claims: 0` moves to a small mono footer stat `Claim race · double-claims 0` (keep for judges).
- **Add a task:** keep recorder/upload/demo flow; `STAGES` as a `ProgressSteps` horizontal stepper; result renders
  as the same `StepTimeline` the worker sees (WYSIWYG).
- **Reports:** worker picker → `ReportView`: KPI row (`MetricTile`: sessions, mistakes, help requests — mono),
  `TrendCard` per task (sparkline of `mistakes_per_attempt`, `trend` in words: "Improving"), `hardest_steps` list,
  "Notes remembered" (Moss notes), read-aloud version card. Footer "Numbers measured from this worker's sessions."
- Support-level override: on WorkerCard step row, `SupportMeter` is a menu (existing `set_support_level` reducer,
  supervisor-only) → "Set to: Full help / Short cue / Alerts only / Independent".

### 4.6 `/buddy` (C)
Phone frame (Pizarra 8 px, radius 36, max 360) centered on cream; on ≤ 480 px the frame disappears (it IS a phone).
- Name: h1 `Be a help buddy` · "We'll ping you when a coworker needs a hand." input + `Start getting alerts`.
- Waiting (Río screen): ripple OK here (calm). `No one needs a hand right now.` + `You're on the list, {name}.`
- Help (Río): eyebrow `DRIGIL · BUDDY PHONE` · `{name} needs a hand.` · `Step {n}: {instruction}` · step photo ·
  Sol `I'll help` · outline `Not right now`. Claimed → cream confirmation `You're on it. Go to {name}.`; lost race →
  `{other} is already going. Thank you!`

---

## 5. Research → screens

| Research idea | Worker sees | Supervisor sees |
|---|---|---|
| Task analysis | `StepTimeline` with a photo per step | Generated steps in Add a task, editable |
| Video modeling | "Done right looks like this" photo beside the camera | Reference frame per step on Floor |
| Systematic instruction / least prompting | One `CorrectionBubble` at a time, "Almost." + fix, silence when unsure | Corrections count per step in Reports |
| Prompt fading | `SupportChip` in worker words ("On your own"), level-up toast | `SupportMeter` per step + trend arrow, override menu |
| Natural supports | `I need help` → "{buddy} is on the way" | Help tab: routed to buddy → supervisor, who claimed |
| Self-monitoring | Finish screen "Things we practiced" | Read-aloud report for the worker |

---

## 6. Stone replacements (components)

| Component | Anatomy | States | CSS notes |
|---|---|---|---|
| `StepTimeline` | ordered list; each item: photo thumb (radius 12), number, short label (`verbOf` + object, ≤ 4 words), connector line | `done` (Musgo check badge + "Done" sr-text), `now` (Sol 3 px ring + `Now` chip, Pizarra text), `next` (70 % opacity) | `orientation: horizontal\|vertical`, `size: sm 40/md 72/lg 120`; horizontal scrolls with snap on mobile; connector `--line`, done segment Musgo |
| `SupportChip` (worker) | pill: 4-dot icon + word from `LEVELS[l].worker` | levels 0–3 | card bg, Pizarra text, dots fill Río; never Sol |
| `SupportMeter` (supervisor) | 4 segment bar + `LEVELS[l].name` + optional trend `↑ Improving` | 0–3, `editable` | segments 12×6, Río filled / `--line` empty; mono label |
| `CorrectionBubble` | speaker avatar (initial on Río circle) + "{name}'s voice" + quote text, tail | `speaking` (3 bar equalizer), `idle` | card bg, quote 20 px Onest 500, starts "Almost."; reduced motion → static bars |
| `StatCard` | big mono number, label, source chip `[n] Source, year` | `empty` shows "—" | number 40 px Spline Sans Mono |
| `FeatureStep` | `01` mono, h3, 1–2 lines, vignette slot | — | vignette card 4:3 |
| `GlassesMock` | rounded frame (radius 28, Pizarra 8 px border) over photo, top HUD (`STEP 2 OF 4`), CorrectionBubble, StepTimeline sm | `sample` label | aspect 4:3; subtle vignette gradient |
| `RoleCard`, `TaskCard`, `WorkerCard`, `HelpCard`, `TrendCard` | as in §4 | hover/focus lift | `.card` base |
| Logo / app icon | `AppIcon` (three rising stones) stays; `StonePath`/`Stone`/`StoneLegend` remain exported but unused in pages | — | remove `.brand-mark` purple chip |

---

## 7. Build split (strict ownership)

**Package A — shell, tokens, landing, /why, /choose**
Owns: `styles/tokens.css`, `styles/piedra.css`, `styles/home.css`, `styles/app.css` (header/footer/button/input rules
only), `components/Brand.tsx`, `components/AppShell.tsx`, `components/Layout.tsx`, new `components/SiteHeader.tsx`,
`SiteFooter.tsx`, `States.tsx`, `components/viz/*` (StepTimeline, SupportChip, SupportMeter, CorrectionBubble,
StatCard — **A builds these first, within the first slice, and B/C import them**), `pages/Home.tsx`, new
`pages/Why.tsx`, `pages/Choose.tsx`, `main.tsx` (add `/why`, drop Atkinson imports), `index.html`, `public/favicon.svg`.
Accept: light only on a dark-mode Mac; no `#111` bar, no lavender/purple anywhere (every accent var in tokens.css/app.css/idd.css maps to a Piedra token);
header identical on `/`, `/why`, `/choose`, `/worker`, `/supervisor`, `/lab`; landing has all 7 sections; stats show
"—" until sourced; /why has 5 MethodRows + sources; 390 px no horizontal scroll; Lighthouse a11y ≥ 95 on `/`.

**Package B — worker screens**
Owns: `pages/Worker.tsx`, `styles/worker.css`, `components/LiveCheck.tsx`, `CameraStage.tsx`, `WorkerFading.tsx`.
Imports (does not edit) A's viz components + States. Accept: no `StonePath`/`StoneLegend` in worker pages; one Sol
element per screen (help button) besides the `Now` ring; Start → run → finish works with webcam and with video
stand-in; help bar reachable at 390 px; no emoji; all copy first-grade, "Almost." corrections; End task asks to confirm.

**Package C — supervisor + buddy**
Owns: `pages/SupervisorHome.tsx`, `pages/Buddy.tsx`, `styles/supervisor.css`, new `styles/buddy.css`,
`components/Independence.tsx`, `Conversations.tsx`, `RaceLog.tsx`, `components/ui.tsx` (MetricTile/LevelMeter only).
Imports A's viz + States. Accept: `Floor` tab default and shows live sessions from SpacetimeDB; active tab readable
(contrast ≥ 4.5); support level shown in words with override menu calling `set_support_level`; help claim race still
works across two browsers (double-claims 0 shown in footer stat); buddy screen fits 360 px; Reports render sparkline
from `mistakes_per_attempt`.

**Shared rules.** Nobody but A edits tokens/piedra.css/Brand.tsx/AppShell/Layout/main.tsx; B and C request token
additions from A. No new dependencies without A's OK. Do not touch `lib/*` APIs or the SpacetimeDB module.
