// drigil brand pieces (Piedra direction): name, app icon, mini mark, stones.
// Styles live in styles/piedra.css. Stone size = the help a step still gets (fading level 0–3),
// so never resize a stone for layout; pass the real level.

/** The product name, everywhere. Always lowercase in the wordmark. */
export const BRAND = 'drigil'

/** Rounded Río square, three stones rising, the top one Sol. No text. */
export function AppIcon({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={BRAND}>
      <rect width="120" height="120" rx="26" fill="#0F3B3A" />
      <ellipse cx="42" cy="80" rx="15" ry="10" fill="#C9C5BD" />
      <ellipse cx="62" cy="62" rx="12" ry="8" fill="#C9C5BD" />
      <ellipse cx="84" cy="44" rx="10" ry="7" fill="#F3C14B" />
    </svg>
  )
}

/** Three tiny stones (~16 px tall) for headers, next to the wordmark or an eyebrow. */
export function MiniStones({ height = 16 }: { height?: number }) {
  return (
    <svg viewBox="0 0 44 24" height={height} width={(height * 44) / 24} aria-hidden>
      <ellipse cx="7" cy="18" rx="6.5" ry="4.2" fill="#C9C5BD" />
      <ellipse cx="21" cy="12" rx="5.2" ry="3.4" fill="#C9C5BD" />
      <ellipse cx="35" cy="6" rx="4.4" ry="2.9" fill="#F3C14B" />
    </svg>
  )
}

/** Header brand: mini stones + lowercase wordmark. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className="brand-mark">
      <MiniStones height={Math.round(size * 0.7)} />
      <span className="brand-word" style={{ fontSize: size }}>
        {BRAND}
      </span>
    </span>
  )
}

export type StoneState = 'done' | 'now' | 'upcoming'

const LEVEL_WORDS = ['full help', 'short cues', 'alerts only', 'on their own']

/** "Slide the sleeve onto the cup." → "slide" (first word, lowercase), for `n · verb` stone labels. */
export const verbOf = (instruction: string) => (instruction.trim().split(/\s+/)[0] ?? '').replace(/[^a-z'-]/gi, '').toLowerCase()

/** One step as a stone. `base` = full-help width for this context (hero 140, worker card 84, floor 56). */
export function Stone({
  n,
  total,
  state,
  level = 0,
  label,
  base,
  ripple = false,
  as: Tag = 'div',
}: {
  n: number
  total?: number
  state: StoneState
  level?: number
  /** visible text, e.g. "2 · slide"; dropped automatically when the stone is small */
  label?: string
  base?: number
  /** animated ring around the "now" stone (respects reduced motion) */
  ripple?: boolean
  as?: 'div' | 'li'
}) {
  const lvl = Math.max(0, Math.min(3, Math.round(level)))
  const k = [1, 0.8, 0.62, 0.45][lvl]
  const width = (base ?? 140) * k
  const showLabel = label && width >= 70
  const aria = `Step ${n}${total ? ` of ${total}` : ''}${label ? `, ${label.replace(/^\d+\s*·\s*/, '')}` : ''}, ${state === 'now' ? 'happening now' : state}, ${LEVEL_WORDS[lvl]}`
  const stone = (
    <Tag className="stone" data-state={state} data-level={lvl} role="img" aria-label={aria} style={base ? ({ '--base': `${base}px` } as React.CSSProperties) : undefined}>
      {showLabel && <span className="stone-label">{label}</span>}
      {!showLabel && state === 'done' && <span aria-hidden>✓</span>}
    </Tag>
  )
  if (ripple && state === 'now') {
    return (
      <span className="ripple-wrap">
        <span className="ripple-ring" aria-hidden />
        {stone}
      </span>
    )
  }
  return stone
}

/** A task as a row of stones, in step order. */
export function StonePath({
  steps,
  current,
  levels = {},
  base = 84,
  finished = false,
  labels = true,
  title,
}: {
  steps: { id: number; instruction: string }[]
  /** index of the step happening now (0-based) */
  current: number
  /** step id → help level 0–3 */
  levels?: Record<number, number>
  base?: number
  finished?: boolean
  labels?: boolean
  title?: string
}) {
  return (
    <ol className="stone-path" aria-label={`${title ?? 'Task'}, ${steps.length} steps`}>
      {steps.map((s, i) => (
        <li key={s.id}>
          <Stone
            n={i + 1}
            total={steps.length}
            state={finished || i < current ? 'done' : i === current ? 'now' : 'upcoming'}
            level={levels[s.id] ?? 0}
            label={labels ? `${i + 1} · ${verbOf(s.instruction)}` : undefined}
            base={base}
          />
        </li>
      ))}
    </ol>
  )
}

/** The legend that goes with the first stone path on a screen. */
export function StoneLegend() {
  return <p className="caption">Stone size = help the step still gets. Green: done. Sun: now.</p>
}
