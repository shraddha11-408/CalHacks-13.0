import type { ReactNode } from 'react'
import { LEVEL_NAME, TIER_LABEL, fmtLatency } from '../format'
import type { HealthState, SupportLevel, Tier, VerdictStatus } from '../types'

/** Tier badge. Shown everywhere a verdict or answer appears, always with latency. */
export function TierBadge({ tier, latency_ms }: { tier: Tier; latency_ms?: number }) {
  return (
    <span className={`tier tier-${tier}`}>
      <span className="tier-dot" aria-hidden />
      {TIER_LABEL[tier]}
      {latency_ms !== undefined && <span className="tier-latency num">· {fmtLatency(latency_ms)}</span>}
    </span>
  )
}

const VERDICT: Record<VerdictStatus, { cls: string; label: string }> = {
  done: { cls: 'verdict-done', label: 'Done' },
  confirming: { cls: 'verdict-working', label: 'Looks done · checking again' },
  finished: { cls: 'verdict-done', label: 'Task finished' },
  mistake: { cls: 'verdict-almost', label: 'Almost' }, // mistakes are amber, never red
  in_progress: { cls: 'verdict-working', label: 'Working' },
  unclear: { cls: 'verdict-unclear', label: 'Not sure · quiet' },
  skipped: { cls: 'verdict-working', label: 'Moved on' },
  help: { cls: 'badge-urgent', label: 'Help' },
  unavailable: { cls: 'verdict-unclear', label: 'Models busy' },
}

export function VerdictPill({ status }: { status: VerdictStatus | string }) {
  const v = VERDICT[status as VerdictStatus] ?? VERDICT.unclear
  return (
    <span className={`verdict ${v.cls}`}>
      {status === 'done' && <span aria-hidden>✓</span>}
      {v.label}
    </span>
  )
}

/** Required on any simulated data. */
export function Simulated({ corner = false, note }: { corner?: boolean; note?: string }) {
  return (
    <span className={`sim ${corner ? 'sim-corner' : ''}`} title={note ?? 'This data is simulated, not measured.'}>
      Simulated
    </span>
  )
}

export function Panel({
  title,
  actions,
  simulated,
  children,
  className = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  simulated?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {simulated && <Simulated corner />}
      {(title || actions) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

const HEALTH_WORD: Record<HealthState, string> = { ok: 'OK', degraded: 'Degraded', down: 'Down', off: 'Not connected' }

export function HealthDots({ items }: { items: { name: string; state: HealthState }[] }) {
  return (
    <div className="health" role="list" aria-label="System health">
      {items.map((i) => (
        <span key={i.name} className="health-item" role="listitem" title={`${i.name}: ${HEALTH_WORD[i.state]}`}>
          <span className={`dot dot-${i.state}`} aria-hidden />
          {i.name}
          <span className="visually-hidden">: {HEALTH_WORD[i.state]}</span>
        </span>
      ))}
    </div>
  )
}


export function LevelMeter({ level }: { level: SupportLevel }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="levels" aria-hidden>
        {[0, 1, 2, 3].map((l) => (
          <span key={l} className={`level-pip ${l <= level ? 'on' : ''}`} />
        ))}
      </span>
      <span>
        {level} · {LEVEL_NAME[level]}
      </span>
    </span>
  )
}

export function MetricTile({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
      {children}
    </div>
  )
}

export function ConsentBanner({ ok, who, detail }: { ok: boolean; who: string; detail: string }) {
  return (
    <div className={`consent-banner ${ok ? '' : 'missing'}`} role="status">
      <span aria-hidden style={{ fontSize: 24 }}>
        {ok ? '🎙️' : '⏸'}
      </span>
      <div>
        <strong>{ok ? `Voice consent on file — ${who}` : `No voice consent yet — ${who}`}</strong>
        <div className="small">{detail}</div>
      </div>
    </div>
  )
}

/** Shows exactly what the voice said. aria-live so screen readers hear it too. */
export function CaptionBar({ text, speaking, speaker = 'Coach voice' }: { text: string; speaking: boolean; speaker?: string }) {
  return (
    <div className={`caption caption-bar on-rio ${speaking ? '' : 'quiet'}`}>
      <span className="caption-wave" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="caption-speaker">{speaker}</span>
      <span aria-live="polite" style={{ flex: 1 }}>
        “{text}”
      </span>
    </div>
  )
}

export function TierLamps({ active, latency_ms, tiers = ['bitdeer', 'claude', 'moss'] }: { active: Tier | null; latency_ms?: number; tiers?: Tier[] }) {
  return (
    <div className="lamps" role="list" aria-label="Which tier decided">
      {tiers.map((t) => (
        <div key={t} role="listitem" className={`lamp tier-${t} ${active === t ? 'on' : ''}`} aria-current={active === t}>
          <span className="dot" aria-hidden />
          {TIER_LABEL[t]}
          {active === t && latency_ms !== undefined && <span className="num" style={{ fontWeight: 400 }}>{fmtLatency(latency_ms)}</span>}
        </div>
      ))}
    </div>
  )
}

export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="row" style={{ gap: 10 }} aria-label={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            width: i === current ? 36 : 18,
            height: 18,
            borderRadius: 9,
            background: i < current ? 'var(--primary)' : i === current ? 'var(--almost-fill)' : 'var(--surface-2)',
            border: '1px solid var(--line)',
            transition: 'all var(--dur) var(--ease)',
          }}
        />
      ))}
      <span className="muted num" style={{ marginLeft: 6 }}>
        Step {current + 1} of {total}
      </span>
    </div>
  )
}
