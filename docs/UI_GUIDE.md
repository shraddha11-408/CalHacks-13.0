# drigil Frontend UI Guide (brand direction 1: Piedra)

> **Product name: drigil.** This guide was written for the name "Pasito"; read every "Pasito"/"pasito" below as
> **drigil** (wordmark always lowercase `drigil`). The name lives in one constant: `BRAND` in
> `web/src/components/Brand.tsx`.
>
> **Already built (use, don't redefine):** `web/src/styles/piedra.css` (all tokens below, the old app tokens
> remapped to this palette, `.stone`, `.stone-path`, `.rising`, `.water`, `.on-rio`, `.wordmark`, `.tagline`,
> `.lede`, `.eyebrow`, `.caption`, `.quote`, `.metric`, `.card-stone`, `.btn-sol`, `.btn-outline`, `.ripple-ring`,
> `.brand-mark`) and `web/src/components/Brand.tsx` (`BRAND`, `AppIcon`, `MiniStones`, `BrandMark`, `Stone`,
> `StonePath`, `StoneLegend`, `verbOf`). Fonts are self-hosted (@fontsource), no Google Fonts link needed.

Every task is a path of stones across the river. Each stone is one step. As someone needs less help, the stones get
smaller, until they walk it on their own. Tagline: **"Little steps to independence."**

## 1. The idea

| Visual | Meaning |
|---|---|
| Path of stones | A task, one stone per step, in order |
| Stone size | Help the step still gets (fading level). Big = full instructions, small = barely any help |
| Green (Musgo) stone | Step done |
| Yellow (Sol) stone with a ring | The step happening now |
| Pale (Piedra) stone | A step still to come |
| Ripples on dark water | Calm, ongoing support in the background |
| The worker crossing alone | Independence, the goal |

Rules:
1. **Sol yellow means "a person is needed."** Only bright color. Only for help requests and the step happening now. Never decoration, success, marketing highlights.
2. **Size carries meaning.** Never resize a stone for layout. Smaller stone = that step really gets less help.
3. **Calm by default.** One idea per screen, short sentences, lots of room.

## 2. Color tokens

| Token | Hex | Role |
|---|---|---|
| `--rio` | `#0F3B3A` | Main dark surface: hero, app icon, buddy phone screen |
| `--pizarra` | `#2A3133` | Text on light, phone frame, primary-button text |
| `--piedra` | `#C9C5BD` | Stones, wordmark on dark, quiet fills |
| `--musgo` | `#6F8A4B` | "Done." Done stones and done states only |
| `--sol` | `#F3C14B` | "A person is needed." Help requests and current step only |
| `--cream` | `#ECE8E1` | Light page background |
| `--card` | `#F7F5F0` | Card surface on cream |
| `--ink-muted` | `#5E605C` | Secondary text on light |
| `--rio-muted` | `#9FB3AE` | Secondary text on Río |
| `--line` | `rgba(42,49,51,.14)` | Hairline dividers on light |
| `--line-dark` | `rgba(201,197,189,.18)` | Hairlines and ripples on Río |

Contrast: cream on Río 10.07 (body on dark) · Piedra on Río 7.15 · Sol on Río 7.35 · Pizarra on Sol 7.91 ·
Pizarra on card 12.16 · ink-muted on cream 5.21 · rio-muted on Río 5.58 · **Musgo on card 3.56: fills/icons only,
never small text** · **Sol on card 1.54: never text** (Sol on light = fill with Pizarra outline/label) ·
**Piedra on card 1.58: never text** (upcoming stones on light need a hairline outline).
Never rely on color alone: current step also gets a ring, done steps a check or the word "done", every stone an aria-label.

## 3. Typography

Display **Bricolage Grotesque 800** (wordmark, headlines) · Body **Onest 400/500** · Data **Spline Sans Mono 400/500**
(times, counts, measured numbers, eyebrows). CSS vars: `--font-display`, `--font-body`, `--font-mono`.

| Token | Size | Family | Example |
|---|---|---|---|
| wordmark | 96–160 px / 0.9, -0.04em, lowercase | Display 800 | `drigil` |
| h1 | 40 px / 1.1, -0.02em | Display 800 | "Jordan needs a hand." |
| h2 | 28 px / 1.15 | Display 800 | "Jordan" |
| tagline | 24 px / 1.3 | Body 500 | "Little steps to independence." |
| body | 17 px / 1.5 | Body 400 | "Put a sleeve on a cup" |
| quote | 20 px / 1.35 | Body 500 | "Almost. Turn the sleeve so the words read up." |
| caption | 13 px / 1.45 | Body 400 | "Stone size = help the step still gets." |
| eyebrow | 11–12 px, uppercase, 0.12em | Mono 500 | `SAMPLE · STEP 2 OF 3` |
| metric | 20–32 px, tabular | Mono 400 | `2.0 s` |

Wordmark always lowercase. Headlines sentence case, never Title Case. Measured numbers always mono.
Eyebrows use " · " as separator: `DRIGIL · BUDDY PHONE`.

## 4. Shape, depth, spacing
Radius: cards 20 px, phone screen 28, phone frame 36, app icon 22%, buttons pill. Spacing 4 px base: 8, 12, 16, 24,
32, 48, 64. Card padding 20–24. Section padding 48–64 desktop, 24 phones. Card shadow
`0 1px 2px rgba(15,59,58,.06), 0 8px 24px rgba(15,59,58,.08)`. No sharp corners, no hard borders except hairlines and the "now" ring.

## 5. Components

**5.1 Stone.** Ellipse 1.6:1, lit top-left, soft shadow. States upcoming (Piedra), now (Sol + ring), done (Musgo).
Width by help level: 0 Full 100% · 1 Cue 80% · 2 Alerts 62% · 3 Independent 45%. Base width per context: hero 140 px,
worker card 84 px, floor tiles 56 px. Labels inside: mono lowercase `number · verb` (`1 · pick up`); drop when
too small, keep in aria-label. → `<Stone>` / `<StonePath>`.

**5.2 Stone path.** Hero/storytelling: rising diagonal bottom-left → top-right, stones smaller as they rise, final one
Sol with ripple ring (`.stone-path.rising` + `--i`). Product screens: straight row in step order, 8–12 px gaps.
First use on a screen gets the legend: *"Stone size = help the step still gets. Green: done. Sun: now."* (`<StoneLegend/>`).

**5.3 Ripple water** `.water`: dark Río with faint rings + warm glow top-right. Ripples 15–20% opacity, texture only.
Only one animated ring, around the "now" stone, only with motion allowed.

**5.4 Hero.** Left, top to bottom: eyebrow, wordmark, tagline, one short paragraph. Stone path on the right. Padding 64, min-height 480.

**5.5 Worker card (coach floor).** Light card (`--card`, radius 20, padding 22×24, max ~420). Top to bottom:
1 header row: name (Display 800, 22–28 px) left, eyebrow `STEP 2 OF 3` right (`SAMPLE · ` when simulated);
2 task line (body); 3 stone path (base 84); 4 legend caption (first card only); 5 hairline; 6 eyebrow `JORDAN HEARD`;
7 last spoken line as a quote (body 500, ~19–20 px) in straight double quotes.

**5.6 Buddy phone (help request).** The one loud screen. Dark Río screen (radius 28, padding 24) inside an 8 px
Pizarra frame, max ~320 wide. 1 eyebrow `DRIGIL · BUDDY PHONE` (rio-muted); 2 headline `Jordan needs a hand.`
(Display 800, cream, 28–32); 3 context `Step 2: sliding the sleeve on. You are the first one asked.` (body,
rio-muted); 4 primary **Sol pill**, Pizarra text, `I'll help`; 5 secondary outline pill (cream 40% border), cream
text, `Not right now`. Buttons ≥48 px, full width. One Sol button per screen. After "I'll help", replace buttons with a
calm cream confirmation (no more Sol).

**5.7 App icon.** Río rounded square, three stones rising, two Piedra, top one Sol. No text. Small version next to
the wordmark/eyebrow in headers (~16 px tall). → `<AppIcon>`, `<MiniStones>`, `<BrandMark>`.

**5.8 Specimens** (slides/docs): round swatches with Spanish name (body 600) + hex (mono, muted); type rows split by hairlines.

## 6. Voice and copy
Short and plain, first-grade reading level for workers, one action per sentence. Name the person ("Jordan needs a
hand.", not "Help request received."). Never blame: corrections start with "Almost." then the fix; never "Wrong"/"Error"
alone. Say where they are ("Step 2: sliding the sleeve on."). Give an easy no ("Not right now" as visible as "I'll help").
Label simulated data with `SAMPLE ·`. Sentence case everywhere; eyebrows are the only uppercase.

## 7. Do / don't
Do: Sol only for "person needed"/"now" · stone size = real help level · measured numbers in mono · one idea per
screen · aria-label on every stone · faint ripples, still under reduced motion · dark Río for moments that matter (hero, help).
Don't: Sol for success/decoration · resize stones for layout · mix fonts in a number · dense chart dashboards ·
rely on green vs yellow alone · animate everything · long reading text on dark.

## 8. Checklist per screen
- [ ] Only the five brand colors + neutrals.
- [ ] Sol at most once, only for help or the current step.
- [ ] Stone sizes from real help levels.
- [ ] Text ≥ 4.5:1 contrast, large headlines ≥ 3:1.
- [ ] Tap targets ≥ 48 px.
- [ ] Every stone has an aria-label; current step not marked by color alone.
- [ ] Animations respect prefers-reduced-motion.
- [ ] Simulated data labeled SAMPLE.
- [ ] Copy plain, names the person, corrections start with "Almost."
- [ ] Works at 360 px wide with 16 px side padding.
