import { useMemo, useState } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { LEVELS, levelOf } from '../lib/levels'
import { reducers, tables } from '../module_bindings'
import type { Step } from '../lib/api'

const OUTCOME = { c: 'clean', e: 'needed a correction', a: 'needed a hint' } as Record<string, string>

/**
 * Supervisor · Independence. Everything here is live from SpacetimeDB: the `mastery` table (one row per
 * worker × step, written only by the fading rules or a coach), `worker_progress` (a scheduled rollup),
 * `level_change` (an event table, so changes flash in as they happen) and `device` presence.
 */
export function Independence() {
  const [mastery] = useTable(tables.mastery)
  const [progress] = useTable(tables.workerProgress)
  const [workers] = useTable(tables.worker)
  const [taskRows] = useTable(tables.task)
  const [devices] = useTable(tables.device)
  const [outcomes] = useTable(tables.stepOutcome)
  const setLevel = useReducer(reducers.setSupportLevel)
  const [live, setLive] = useState<{ text: string; up: boolean; at: number }[]>([])
  const [err, setErr] = useState<string | null>(null)

  const steps = useMemo(() => {
    const m = new Map<string, { title: string; steps: Step[] }>()
    for (const t of taskRows) {
      try {
        m.set(t.id, { title: t.title, steps: JSON.parse(t.stepsJson) })
      } catch {
        m.set(t.id, { title: t.title, steps: [] })
      }
    }
    return m
  }, [taskRows])
  const name = (id: string) => workers.find((w) => w.id === id)?.name ?? id
  const stepText = (taskId: string, stepId: number) => steps.get(taskId)?.steps.find((s) => s.id === stepId)?.instruction ?? `Step ${stepId}`

  useTable(tables.levelChange, {
    onInsert: (r) => {
      const up = r.toLevel > r.fromLevel
      const why = r.reason === 'coach' ? `${r.by} set it` : up ? '3 clean in a row' : '2 corrections in the last 5'
      setLive((xs) => [{ text: `${name(r.workerId)} · ${stepText(r.taskId, r.stepId)}: ${levelOf(r.fromLevel).name} → ${levelOf(r.toLevel).name} (${why})`, up, at: Date.now() }, ...xs].slice(0, 8))
    },
  })

  // worker → task → rows
  const byWorker = new Map<string, Map<string, typeof mastery[number][]>>()
  for (const m of mastery) {
    if (!steps.has(m.taskId)) continue // a task that was deleted or re-taught away
    const w = byWorker.get(m.workerId) ?? new Map()
    w.set(m.taskId, [...(w.get(m.taskId) ?? []), m])
    byWorker.set(m.workerId, w)
  }
  const history = [...outcomes].filter((o) => o.reason).sort((a, b) => Number(b.id - a.id)).slice(0, 6)
  const online = devices.filter((d) => d.online)

  const change = (workerId: string, taskId: string, stepId: number, level: number) =>
    setLevel({ workerId, taskId, stepId, level })
      .then(() => setErr(null))
      .catch((e: Error) => setErr(`Could not change the level: ${e.message}`))

  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="muted">
        Support fades as a worker masters a step: {LEVELS.map((l) => l.name).join(' → ')}. A step moves up after 3 clean completions in a row and back
        after 2 corrections in the last 5. You can always change it.
      </p>
      {err && <p className="note-almost">{err}</p>}
      {live.length > 0 && (
        <ul className="feed" aria-live="polite">
          {live.map((l) => (
            <li key={l.at + l.text} className={l.up ? 'feed-up' : 'feed-down'}>
              {l.up ? '▲' : '▼'} {l.text}
            </li>
          ))}
        </ul>
      )}
      {byWorker.size === 0 && <div className="empty">No completed steps yet. Levels appear after a worker finishes a step.</div>}
      {[...byWorker.entries()].map(([wid, tasks]) => {
        const p = progress.find((x) => x.workerId === wid)
        return (
          <section key={wid} className="card stack" style={{ gap: 12 }}>
            <div className="spread">
              <h2 className="section-title" style={{ margin: 0 }}>
                {name(wid)}
              </h2>
              {p && (
                <span className="small muted num">
                  {p.independent} on their own · {p.atAlerts} alerts only · {p.atCue} short cue · {p.atFull} full help · {p.promotions7D} level-ups this week · {p.cleanLast24H} clean steps today
                </span>
              )}
            </div>
            {[...tasks.entries()].map(([tid, rows]) => (
              <div key={tid} className="stack" style={{ gap: 6 }}>
                <span className="small muted">{steps.get(tid)?.title}</span>
                <div className="mastery">
                  {[...rows].sort((a, b) => a.stepId - b.stepId).map((m) => (
                    <div key={m.key} className="mastery-row">
                      <span className="mastery-step">{stepText(tid, m.stepId)}</span>
                      <span className={`lvl lvl-${m.level}`} style={{ marginLeft: 0 }}>
                        <span className="pips" aria-hidden>
                          {[0, 1, 2, 3].map((x) => (
                            <i key={x} className={x <= m.level ? 'on' : ''} />
                          ))}
                        </span>
                        {levelOf(m.level).name}
                      </span>
                      <span className="recent" title="Last outcomes at this level, oldest first">
                        {[...m.recent].map((c, k) => (
                          <i key={k} className={`oc oc-${c}`} title={OUTCOME[c]} />
                        ))}
                        <span className="small muted num">{m.streak ? ` ${m.streak} clean in a row` : ''}</span>
                      </span>
                      <span className="row" style={{ gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" disabled={m.level === 0} onClick={() => change(wid, tid, m.stepId, m.level - 1)}>
                          More help
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={m.level === 3} onClick={() => change(wid, tid, m.stepId, m.level + 1)}>
                          Less help
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )
      })}
      <div className="two-col-min">
        <section className="card stack" style={{ gap: 8 }}>
          <h3>Recent level changes</h3>
          {history.length === 0 ? (
            <p className="small muted">None yet.</p>
          ) : (
            <ul className="plain-list small">
              {history.map((o) => (
                <li key={String(o.id)}>
                  {name(o.workerId)} · {stepText(o.taskId, o.stepId)}: {levelOf(o.levelBefore).name} → {levelOf(o.levelAfter).name}{' '}
                  <span className="muted">({o.reason === 'coach' ? `by ${o.by}` : o.reason === 'promote' ? '3 clean in a row' : '2 corrections in the last 5'} · {o.ts.toDate().toLocaleString()})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <h3>Devices online · {online.length}</h3>
          <ul className="plain-list small">
            {online.map((d) => (
              <li key={d.identity.toHexString()}>
                <span className="dot-on" aria-hidden /> {d.name} <span className="muted">· {d.role.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">Each screen, phone and the edge app has its own SpacetimeDB identity. Only the edge app can record results; only supervisors can change levels.</p>
        </section>
      </div>
    </div>
  )
}
