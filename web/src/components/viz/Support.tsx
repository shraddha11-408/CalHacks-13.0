import { LEVELS, levelOf } from '../../lib/levels'

const clamp = (l: number) => Math.max(0, Math.min(3, Math.round(l)))

/** SupportChip({ level }) — worker-facing pill: 4 dots + LEVELS[l].worker word. Dots fill = help still given. */
export function SupportChip({ level }: { level: number }) {
  const l = clamp(level)
  return (
    <span className="support-chip" aria-label={`Help: ${levelOf(l).worker}`}>
      <span className="sc-dots" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < 4 - l ? 'on' : ''} />)}
      </span>
      {levelOf(l).worker}
    </span>
  )
}

/**
 * SupportMeter({ level, trend?, editable?, onChange? }) — supervisor view: 4 segments + LEVELS[l].name.
 * trend: 'up' (Improving) | 'down' (Needs more help) | 'flat'. editable shows a select calling onChange(level).
 */
export function SupportMeter({
  level,
  trend,
  editable = false,
  onChange,
}: {
  level: number
  trend?: 'up' | 'down' | 'flat'
  editable?: boolean
  onChange?: (level: number) => void
}) {
  const l = clamp(level)
  return (
    <span className="support-meter">
      <span className="sm-bar" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i <= l ? 'on' : ''} />)}
      </span>
      {editable ? (
        <select className="sm-select" value={l} aria-label="Support level" onChange={(e) => onChange?.(Number(e.target.value))}>
          {LEVELS.map((v, i) => <option key={i} value={i}>{v.name}</option>)}
        </select>
      ) : (
        <span className="sm-label">{levelOf(l).name}</span>
      )}
      {trend === 'up' && <span className="sm-trend">↑ Improving</span>}
      {trend === 'down' && <span className="sm-trend">↓ Needs more help</span>}
    </span>
  )
}
