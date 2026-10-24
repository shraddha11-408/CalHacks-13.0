import type { ClaimAttempt } from '../module_bindings/types'

const clockMs = (d: Date) => `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`

/** Every tap on one alert, in the order SpacetimeDB committed them: who won, who was a few ms late. */
export function RaceLog({ attempts, me }: { attempts: ClaimAttempt[]; me?: string }) {
  if (!attempts.length) return null
  const sorted = [...attempts].sort((a, b) => Number(a.id - b.id))
  const t0 = sorted[0].ts.toDate().getTime()
  return (
    <ol className="race" aria-label="Who tapped I'm going">
      {sorted.map((a) => (
        <li key={String(a.id)} className={a.won ? 'race-won' : 'race-lost'}>
          <span aria-hidden>{a.won ? '✓' : '·'}</span>
          <strong>
            {a.by}
            {me && a.by === me ? ' (you)' : ''}
          </strong>
          <span className="small muted num">{a === sorted[0] ? clockMs(a.ts.toDate()) : `+${a.ts.toDate().getTime() - t0} ms`}</span>
          <span className="small muted">{a.won ? 'got it' : `too late, ${a.winner} is going`}</span>
        </li>
      ))}
    </ol>
  )
}
