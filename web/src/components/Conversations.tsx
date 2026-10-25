import { useReducer, useTable } from 'spacetimedb/react'
import { reducers, tables } from '../module_bindings'

const TOOL: Record<string, string> = {
  what_is_my_step: 'looked up the step',
  check_my_work: 'looked with the camera',
  call_a_helper: 'sent a help alert',
  my_progress: 'read the progress',
  change_step: 'changed the step',
  remember: 'saved a note',
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/**
 * Supervisor tab: every conversation a worker has with the coach agent, live. Call metadata is a public
 * table; the words and tool calls come from per-identity views that return rows only to supervisor
 * devices (a buddy phone subscribed to the same views gets nothing). The coach can end any call.
 */
export function Conversations() {
  const [calls] = useTable(tables.agentCall)
  const [turns] = useTable(tables.supervisorTranscript)
  const [tools] = useTable(tables.supervisorToolCalls)
  const [stats] = useTable(tables.agentStats)
  const [workers] = useTable(tables.worker)
  const endCall = useReducer(reducers.coachEndCall)
  const who = (id: string) => workers.find((w) => w.id === id)?.name ?? id

  const sorted = [...calls].sort((a, b) => Number(b.startedAt.microsSinceUnixEpoch - a.startedAt.microsSinceUnixEpoch)).slice(0, 8)
  const total = stats.reduce(
    (a, s) => ({ calls: a.calls + s.calls, turns: a.turns + s.turns, tools: a.tools + s.toolCalls, help: a.help + s.helpAlerts, barge: a.barge + s.bargeIns }),
    { calls: 0, turns: 0, tools: 0, help: 0, barge: 0 },
  )
  // per-worker p50s are rolled up in the module; show the busiest worker's as the headline
  const busiest = [...stats].sort((a, b) => b.turns - a.turns)[0]

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="muted small">
        Workers can tap “Talk with …” and just speak. The coach agent (Cartesia, in your cloned voice) answers, looks through the camera, and sends help. Everything it says and does shows up here
        as it happens. Only supervisor screens can read these words.
      </p>
      <div className="stat-row" aria-label="Measured voice agent numbers">
        <div>
          <span className="stat-v num">{total.calls}</span>
          <span className="stat-l">talks</span>
        </div>
        <div>
          <span className="stat-v num">{total.turns}</span>
          <span className="stat-l">turns</span>
        </div>
        <div>
          <span className="stat-v num">{total.tools}</span>
          <span className="stat-l">tool calls</span>
        </div>
        <div>
          <span className="stat-v num">{total.help}</span>
          <span className="stat-l">help alerts by voice</span>
        </div>
        <div>
          <span className="stat-v num">{total.barge}</span>
          <span className="stat-l">talked over the coach</span>
        </div>
        {busiest && busiest.p50ResponseMs > 0 && (
          <div>
            <span className="stat-v num">
              {(busiest.p50ResponseMs / 1000).toFixed(1)} s · p90 {(busiest.p90ResponseMs / 1000).toFixed(1)} s
            </span>
            <span className="stat-l">answer starts after the worker stops ({who(busiest.workerId)}, measured)</span>
          </div>
        )}
      </div>
      {sorted.length === 0 && <div className="empty">No talks yet.</div>}
      {sorted.map((c) => {
        const lines = [
          ...turns.filter((t) => t.callId === c.callId).map((t) => ({ ts: t.ts.microsSinceUnixEpoch, kind: t.role as 'user' | 'assistant' | 'tool', text: t.text, extra: t.role === 'assistant' && t.responseMs ? `${(t.responseMs / 1000).toFixed(1)} s` : t.interrupted ? 'cut off' : '' })),
          ...tools.filter((t) => t.callId === c.callId).map((t) => ({ ts: t.ts.microsSinceUnixEpoch, kind: 'tool' as const, text: `${TOOL[t.tool] ?? t.tool}: ${t.result.length > 140 ? `${t.result.slice(0, 140)}…` : t.result}`, extra: `${t.latencyMs} ms${t.ok ? '' : ' · failed'}` })),
        ].sort((a, b) => Number(a.ts - b.ts))
        const live = c.status === 'live'
        return (
          <article key={c.callId} className={`convo ${live ? 'convo-live' : ''}`}>
            <div className="spread">
              <strong>
                {who(c.workerId)} {live ? 'is talking with' : 'talked with'} {c.voice || 'the coach'}
              </strong>
              <span className="row" style={{ gap: 8 }}>
                <span className="small muted num">
                  {time(c.startedAt.toDate())} · {c.turns} turns · {c.toolCalls} {c.toolCalls === 1 ? 'tool' : 'tools'}{!live && c.endReason ? ` · ended (${c.endReason.replace('coach:', 'by ')})` : ''}
                </span>
                {live && (
                  <button className="btn btn-secondary btn-sm" onClick={() => void endCall({ callId: c.callId }).catch(() => {})}>
                    End talk
                  </button>
                )}
              </span>
            </div>
            {lines.length > 0 ? (
              <ul className="convo-lines" aria-live={live ? 'polite' : undefined}>
                {lines.map((l, k) => (
                  <li key={k} className={l.kind === 'tool' ? 'convo-tool' : ''}>
                    <span className="convo-who">{l.kind === 'user' ? who(c.workerId) : l.kind === 'assistant' ? 'Coach' : '⚙ tool'}</span>
                    <span>
                      {l.text} {l.extra && <span className="small muted num">· {l.extra}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">{live ? 'Listening…' : 'Nothing was said.'}</p>
            )}
          </article>
        )
      })}
    </div>
  )
}
