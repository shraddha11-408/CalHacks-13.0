import type { CompileEvent, StreamEvent } from '../types'
import { TierBadge, VerdictPill } from './ui'

export function EventStream({ events, label = 'Live events' }: { events: StreamEvent[]; label?: string }) {
  return (
    <ul className="stream" aria-label={label} aria-live="polite">
      {events.map((e, i) => (
        <li key={`${e.ts}-${i}`}>
          <time className="num">{e.ts}</time>
          <span>
            <strong>{e.worker}</strong> · {e.text}
          </span>
          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            {e.status && e.status !== 'unclear' && e.status !== 'not_done' && <VerdictPill status={e.status} />}
            {e.tier && <TierBadge tier={e.tier} latency_ms={e.latency_ms} />}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CompileLog({ events }: { events: CompileEvent[] }) {
  return (
    <pre className="log" aria-label="Droid compile stream" tabIndex={0}>
      {events.map((e, i) => (
        <div key={i}>
          <span className="k-ts">{e.ts} </span>
          <span className={`k-${e.kind}`}>{e.text}</span>
        </div>
      ))}
    </pre>
  )
}
