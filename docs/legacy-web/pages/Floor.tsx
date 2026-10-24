import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HelpRequestCard, WorkerCard } from '../components/cards'
import { CompileLog, EventStream } from '../components/streams'
import { Tray } from '../components/Tray'
import { HealthDots, MetricTile, Panel, TierBadge } from '../components/ui'
import { fmtLatency, fmtUsd, pct } from '../format'
import { useEdgeHealth } from '../edge'
import { CHECKERS, COMPILE_LOG, EVENTS, HEALTH, HELP_REQUESTS, LAST_MOSS_ANSWER, METRICS, SESSIONS, TASK_LIBRARY, TRAY_AFTER, WORKERS } from '../mock'
import type { HelpRequest, Session, StreamEvent } from '../types'

const toSec = (ts: string) => ts.split(':').reduce((a, p) => a * 60 + Number(p), 0)

function useReplay() {
  const [session, setSession] = useState<Session | null>(null)
  const [shown, setShown] = useState<StreamEvent[]>([])
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!session) return
    let i = 0
    const step = () => {
      const e = session.events[i]
      if (!e) return
      setShown((s) => [e, ...s])
      const next = session.events[i + 1]
      i++
      if (next) {
        // 10x speed, clamped so the demo stays watchable
        const gap = Math.min(Math.max(((toSec(next.ts) - toSec(e.ts)) * 1000) / 10, 300), 4500)
        timer.current = window.setTimeout(step, gap)
      }
    }
    step()
    return () => window.clearTimeout(timer.current)
  }, [session])
  const play = (s: Session) => {
    setShown([])
    setSession(s)
  }
  return { session, shown, play, stop: () => setSession(null) }
}

function MetricsStrip() {
  const m = METRICS
  return (
    <Panel title="This shift" simulated>
      <div className="metrics">
        <MetricTile
          label="Tier mix"
          value={<span style={{ fontSize: 20 }}>{pct(m.tier_mix.checker)} checker</span>}
          sub={`${pct(m.tier_mix.bitdeer)} Bitdeer · ${pct(m.tier_mix.claude)} Claude`}
        >
          <div className="tiermix" role="img" aria-label="Tier mix bar">
            <span style={{ flex: m.tier_mix.checker, background: 'var(--chart-checker)' }} />
            <span style={{ flex: m.tier_mix.bitdeer, background: 'var(--chart-bitdeer)' }} />
            <span style={{ flex: m.tier_mix.claude, background: 'var(--chart-claude)' }} />
          </div>
        </MetricTile>
        <MetricTile label="Latency p50" value={fmtLatency(m.p50_ms)} sub={`p99 ${fmtLatency(m.p99_ms)}`} />
        <MetricTile label="Cost per check" value={fmtUsd(m.cost_per_check_usd)} sub="all tiers, averaged" />
        <MetricTile label="False corrections" value={pct(m.false_correction_rate, 1)} sub="told “almost” when right" />
        <MetricTile label="Questions, no model call" value={pct(m.moss_no_model_share)} sub={`Moss p50 ${fmtLatency(m.moss_p50_ms)}`} />
      </div>
    </Panel>
  )
}

function HelpQueue() {
  const [reqs, setReqs] = useState<HelpRequest[]>(HELP_REQUESTS)
  const claim = (id: string) => setReqs((r) => r.map((x) => (x.id === id ? { ...x, status: 'claimed', claimed_by: 'You' } : x)))
  return (
    <Panel title="Help queue" simulated actions={<span className="small muted">Buddy first · supervisor after 20 s</span>}>
      <div className="stack">
        {reqs.map((r) => (
          <HelpRequestCard key={r.id} req={r} onClaim={() => claim(r.id)} />
        ))}
      </div>
    </Panel>
  )
}

function CheckerPanel() {
  const word = { testing: 'Testing', shadow: 'Shadow', deployed: 'Deployed', retired: 'Retired' } as const
  const cls = { testing: 'badge-soft', shadow: 'tier tier-bitdeer', deployed: 'tier tier-checker', retired: 'badge-soft' } as const
  return (
    <Panel title="Checkers · Droid compile stream" simulated>
      <div className="stack">
        <CompileLog events={COMPILE_LOG} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th className="n">Agree</th>
              </tr>
            </thead>
            <tbody>
              {CHECKERS.map((c) => (
                <tr key={c.step_id}>
                  <td>
                    {c.step_id} · {c.label} <span className="muted small">v{c.version}</span>
                  </td>
                  <td>
                    <span className={cls[c.status]}>{word[c.status]}</span>
                  </td>
                  <td className="n num">{c.status === 'shadow' ? `${c.agree_count}/10` : c.agree_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Shadow checkers promote to deployed after 10 agreeing live checks. Step 4 (fold) has no checker, so it goes to the models.</p>
      </div>
    </Panel>
  )
}

function MossSearch() {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return TASK_LIBRARY.filter((r) => `${r.task} ${r.text} ${r.success}`.toLowerCase().includes(t)).slice(0, 4)
  }, [q])
  return (
    <Panel title="Task library search" simulated actions={<TierBadge tier="moss" latency_ms={LAST_MOSS_ANSWER.latency_ms} />}>
      <div className="stack">
        <label className="visually-hidden" htmlFor="moss-q">
          Search taught tasks
        </label>
        <input id="moss-q" className="search" placeholder="Have we taught this? Try “lotion” or “towels”" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.map((r) => (
          <div key={`${r.task_id}-${r.step_id}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div style={{ width: 72, flex: 'none' }}>
              <Tray tray={r.task_id === 'amenity_tray_v1' ? TRAY_AFTER[r.step_index + 1] : {}} />
            </div>
            <div>
              <div className="small muted">
                {r.task} · step {r.step_index + 1}
              </div>
              <div>{r.text}</div>
            </div>
          </div>
        ))}
        {q && !results.length && <p className="muted small">Not taught yet.</p>}
        <div className="small muted">
          Last worker question: <strong>{LAST_MOSS_ANSWER.worker}</strong> asked “{LAST_MOSS_ANSWER.question}” → “{LAST_MOSS_ANSWER.answer}”
        </div>
      </div>
    </Panel>
  )
}

export function FloorPage() {
  const nav = useNavigate()
  const edge = useEdgeHealth()
  const replay = useReplay()
  const health = [{ name: 'Edge app', state: edge.state }, ...HEALTH]
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Coach Floor</h1>
          <p className="muted">Everyone on shift, live.</p>
        </div>
        <HealthDots items={health} />
      </div>
      <MetricsStrip />
      <div className="floor-grid">
        <div className="stack" style={{ gap: 20 }}>
          <Panel title="Workers" simulated>
            <div className="worker-grid">
              {WORKERS.map((w) => (
                <WorkerCard key={w.id} worker={w} onOpen={() => nav(`/worker/${w.id}`)} />
              ))}
            </div>
          </Panel>
          <Panel
            title={replay.session ? `Replay · ${replay.session.worker} · 10x` : 'Live events'}
            simulated
            actions={replay.session && <button className="btn btn-ghost" onClick={replay.stop}>Back to live</button>}
          >
            <EventStream events={replay.session ? replay.shown : EVENTS} />
          </Panel>
          <Panel title="Sessions" simulated>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Started</th>
                    <th className="n">Minutes</th>
                    <th className="n">Prompts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {SESSIONS.map((s) => (
                    <tr key={s.id}>
                      <td>{s.worker}</td>
                      <td>{s.started}</td>
                      <td className="n num">{s.duration_min}</td>
                      <td className="n num">{s.prompts}</td>
                      <td className="n">
                        <button className="btn btn-secondary" style={{ minHeight: 40, padding: '6px 14px', fontSize: 16 }} onClick={() => replay.play({ ...s })}>
                          ▶ Replay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <HelpQueue />
          <CheckerPanel />
          <MossSearch />
        </div>
      </div>
    </div>
  )
}
