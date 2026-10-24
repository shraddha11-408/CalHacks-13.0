import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react'
import { StdbGate } from '../components/Stdb'
import { HealthDots, MetricTile, Panel, TierBadge, VerdictPill } from '../components/ui'
import { asTier, fmtLatency, pct } from '../format'
import { api, type Memory, type Step } from '../lib/api'
import { apiUrl } from '../lib/audio'
import { reducers, tables } from '../module_bindings'
import type { HealthState } from '../types'

/** Old live dashboard (now under /lab). */
export function SupervisorPage() {
  return <StdbGate>{(err) => <Dashboard error={err} />}</StdbGate>
}

const ago = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : d.toLocaleTimeString()
}
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function Dashboard({ error }: { error: string | null }) {
  const conn = useSpacetimeDB()
  const [sessions] = useTable(tables.session)
  const [help] = useTable(tables.helpRequest)
  const [events] = useTable(tables.stepEvent)
  const [talks] = useTable(tables.talkEvent)
  const [taskRows] = useTable(tables.task)
  const [workers] = useTable(tables.worker)
  const claim = useReducer(reducers.claimHelp)
  const resolve = useReducer(reducers.resolveHelp)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const steps = useMemo(() => {
    const m = new Map<string, Step[]>()
    for (const t of taskRows) {
      try {
        m.set(t.id, JSON.parse(t.stepsJson))
      } catch {
        m.set(t.id, [])
      }
    }
    return m
  }, [taskRows])
  const taskTitle = (id: string) => taskRows.find((t) => t.id === id)?.title ?? id
  const stepText = (taskId: string, stepId: number) => steps.get(taskId)?.find((s) => s.id === stepId)?.instruction ?? `Step ${stepId}`
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id

  const checks = events.filter((e) => ['done', 'mistake', 'in_progress', 'unclear'].includes(e.kind))
  const mistakes = events.filter((e) => e.kind === 'mistake')
  const bitdeerLat = checks.filter((e) => ['bitdeer', 'gemini', 'haiku', 'sonnet'].includes(e.source)).map((e) => e.latencyMs) // live check (Bitdeer paused)
  const claudeLat = checks.filter((e) => e.source === 'claude').map((e) => e.latencyMs)
  const instant = talks.filter((t) => t.answeredBy === 'instant').length

  const openHelp = [...help].filter((h) => h.status !== 'resolved').sort((a, b) => Number(b.id - a.id))
  const active = [...sessions].filter((s) => s.status === 'active').sort((a, b) => b.startedAt.toDate().getTime() - a.startedAt.toDate().getTime())
  const recent = [...events].sort((a, b) => Number(b.id - a.id)).slice(0, 30)

  const health: { name: string; state: HealthState }[] = [{ name: 'SpacetimeDB live', state: conn.isActive ? 'ok' : error ? 'down' : 'degraded' }]

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Supervisor</h1>
          <p className="muted">Live from SpacetimeDB. Every number here is measured from real sessions.</p>
        </div>
        <HealthDots items={health} />
      </div>
      {error && (
        <div className="consent-banner missing" role="alert">
          {error}
        </div>
      )}

      <Panel title={`Help alerts${openHelp.length ? ` · ${openHelp.length}` : ''}`}>
        {openHelp.length ? (
          <div className="stack">
            {openHelp.map((h) => (
              <article key={String(h.id)} className="panel alert-card" style={h.status === 'open' ? { borderColor: 'var(--urgent-fill)' } : undefined}>
                {h.photo ? <img className="help-photo" src={apiUrl(h.photo)} alt={`Photo from ${workerName(h.workerId)}`} /> : <div className="help-photo" />}
                <div className="stack" style={{ gap: 6, flex: 1 }}>
                  <div className="spread">
                    <h3>{workerName(h.workerId)} needs help</h3>
                    {h.status === 'open' ? <span className="badge-urgent">{ago(h.createdAt.toDate())}</span> : <span className="badge-claimed">Claimed by {h.claimedBy}</span>}
                  </div>
                  <span className="small">
                    {taskTitle(h.taskId)} · <strong>{stepText(h.taskId, h.stepId)}</strong>
                  </span>
                  <div className="row">
                    {h.status === 'open' ? (
                      <button className="btn btn-primary" onClick={() => claim({ id: h.id, by: 'Supervisor' }).catch(() => {})}>
                        I'm going
                      </button>
                    ) : (
                      <button className="btn btn-secondary" onClick={() => resolve({ id: h.id, note: 'Helped in person' }).catch(() => {})}>
                        Mark resolved
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No one needs help right now.</p>
        )}
      </Panel>

      <div className="metrics">
        <MetricTile label="Checks" value={checks.length} sub={`${active.length} active session${active.length === 1 ? '' : 's'}`} />
        <MetricTile label="Mistakes caught" value={mistakes.length} sub="gently corrected" />
        <MetricTile label="Live check p50" value={median(bitdeerLat) !== null ? fmtLatency(median(bitdeerLat)!) : '—'} sub={`${bitdeerLat.length} checks`} />
        <MetricTile label="Asked Claude" value={checks.length ? pct(claudeLat.length / checks.length) : '—'} sub={median(claudeLat) !== null ? `p50 ${fmtLatency(median(claudeLat)!)}` : 'when unclear twice'} />
        <MetricTile label="Questions answered instantly" value={talks.length ? pct(instant / talks.length) : '—'} sub={`${talks.length} questions`} />
      </div>

      <div className="two-col">
        <Panel title="Live sessions">
          {active.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Task</th>
                    <th>Step</th>
                    <th>Last check</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((s) => {
                    const lastEv = [...events].filter((e) => e.sessionId === s.id).sort((a, b) => Number(b.id - a.id))[0]
                    const total = steps.get(s.taskId)?.length ?? 0
                    return (
                      <tr key={s.id}>
                        <td>
                          <strong>{workerName(s.workerId)}</strong>
                        </td>
                        <td>{taskTitle(s.taskId)}</td>
                        <td className="num">
                          {s.stepIndex + 1}/{total || '?'}
                        </td>
                        <td>
                          {lastEv ? (
                            <span className="row" style={{ gap: 6 }}>
                              <VerdictPill status={lastEv.kind} />
                              <TierBadge tier={asTier(lastEv.source)} latency_ms={lastEv.latencyMs} />
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No one is working right now.</p>
          )}
        </Panel>
        <Panel title="Mistakes by step">
          <MistakeChart events={mistakes} steps={steps} taskTitle={taskTitle} />
        </Panel>
      </div>

      <div className="two-col">
        <Panel title="Event log">
          {recent.length ? (
            <ul className="stream" aria-label="Recent events">
              {recent.map((e) => (
                <li key={String(e.id)}>
                  <time className="num">{e.ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                  <span>
                    <strong>{workerName(e.workerId)}</strong> · {stepText(e.taskId, e.stepId)}
                    {e.note && <span className="muted small"> — {e.note}</span>}
                  </span>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <VerdictPill status={e.kind} />
                    {e.latencyMs > 0 && <TierBadge tier={asTier(e.source)} latency_ms={e.latencyMs} />}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Events appear here as soon as a worker starts.</p>
          )}
        </Panel>
        <MemoryPanel workers={workers.map((w) => ({ id: w.id, name: w.name }))} />
      </div>

      <Panel title="Tasks" actions={<Link className="btn btn-secondary" to="/teach">+ Teach a task</Link>}>
        {taskRows.length ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {[...taskRows].map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.title}</strong>
                    </td>
                    <td className="num">{steps.get(t.id)?.length ?? 0} steps</td>
                    <td className="n">
                      <Link to={`/coach?task=${t.id}`}>Coach →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No tasks yet.</p>
        )}
      </Panel>
    </div>
  )
}

/** Mistakes per step for the task with the most mistakes. Single series: the title names it, no legend. */
function MistakeChart({ events, steps, taskTitle }: { events: { taskId: string; stepId: number }[]; steps: Map<string, Step[]>; taskTitle: (id: string) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const byTask = new Map<string, number>()
  events.forEach((e) => byTask.set(e.taskId, (byTask.get(e.taskId) ?? 0) + 1))
  const taskId = [...byTask.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!taskId) return <p className="muted">No mistakes logged yet.</p>
  const list = steps.get(taskId) ?? []
  const counts = list.map((s) => events.filter((e) => e.taskId === taskId && e.stepId === s.id).length)
  const max = Math.max(1, ...counts)
  const W = 520
  const rowH = 34
  const labelW = 170
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small muted">{taskTitle(taskId)}</span>
      <svg className="chart" viewBox={`0 0 ${W} ${list.length * rowH}`} role="img" aria-label={`Mistakes per step: ${counts.map((c, i) => `step ${i + 1}: ${c}`).join(', ')}`}>
        {list.map((s, i) => {
          const w = (counts[i] / max) * (W - labelW - 40)
          return (
            <g key={s.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" />
              <text x={0} y={i * rowH + 21}>
                {i + 1}. {s.instruction.slice(0, 22)}
                {s.instruction.length > 22 ? '…' : ''}
              </text>
              {counts[i] > 0 && <rect x={labelW} y={i * rowH + 8} width={Math.max(w, 4)} height={18} rx={4} style={{ fill: 'var(--almost-fill)', opacity: hover === null || hover === i ? 1 : 0.5 }} />}
              <text x={labelW + Math.max(w, 0) + 8} y={i * rowH + 21} className="val">
                {counts[i]}
              </text>
              {hover === i && <title>{`${s.instruction}: ${counts[i]} mistake${counts[i] === 1 ? '' : 's'}`}</title>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MemoryPanel({ workers }: { workers: { id: string; name: string }[] }) {
  const [who, setWho] = useState('')
  const [notes, setNotes] = useState<Memory[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const current = who || workers[0]?.name || ''
  const load = (name: string) =>
    name &&
    api
      .memory(name)
      .then((r) => {
        setNotes(r.notes)
        setErr(r.error)
      })
      .catch((e) => setErr(e.message))
  useEffect(() => {
    void load(current)
  }, [current])
  return (
    <Panel title="What Stepwise remembers" actions={<TierBadge tier="moss" />}>
      <div className="stack">
        {workers.length > 1 && (
          <select className="search" value={current} onChange={(e) => setWho(e.target.value)} aria-label="Worker">
            {workers.map((w) => (
              <option key={w.id} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        {notes.length ? (
          <ul className="transcript">
            {notes.slice(0, 12).map((n) => (
              <li key={n.id}>
                <span className="small muted">{n.kind === 'mistake' ? 'mistake' : 'note'}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{current ? `Nothing remembered about ${current} yet.` : 'No workers yet.'}</p>
        )}
        {current && (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!text.trim()) return
              await api.addMemory(current, text.trim()).catch((x) => setErr(x.message))
              setText('')
              void load(current)
            }}
          >
            <input className="search" style={{ flex: 1 }} placeholder={`Add a note, e.g. "${current} does better with picture cues"`} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-secondary">Add</button>
          </form>
        )}
        {err && <p className="small" style={{ color: 'var(--almost)' }}>Moss: {err}</p>}
      </div>
    </Panel>
  )
}
