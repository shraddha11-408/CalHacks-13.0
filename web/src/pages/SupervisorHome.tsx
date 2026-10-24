import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useReducer, useTable } from 'spacetimedb/react'
import { AppShell } from '../components/AppShell'
import { StdbGate } from '../components/Stdb'
import { fmtLatency } from '../format'
import { api, type Step, type Task, type VideoJob, type WorkerReport } from '../lib/api'
import { apiUrl } from '../lib/audio'
import { reducers, tables } from '../module_bindings'
import { STAGES } from '../lib/stages'

const TABS = [
  { key: 'help', label: 'Help alerts' },
  { key: 'add', label: 'Add a task' },
  { key: 'report', label: 'Worker report' },
] as const
type TabKey = (typeof TABS)[number]['key']

const ago = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : d.toLocaleString()
}

/** /supervisor — help alerts, add a task from a video, generate a worker report. */
export function SupervisorHomePage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) || 'help'
  return (
    <AppShell back={{ to: '/choose', label: 'Back' }}>
      <h1 className="app-title">Supervisor</h1>
      <nav className="tabs" role="tablist" aria-label="Supervisor">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setParams({ tab: t.key })}>
            {t.label}
          </button>
        ))}
      </nav>
      <StdbGate>
        {(err) => (
          <>
            {err && <p className="note-almost">{err}</p>}
            {tab === 'help' && <HelpTab />}
            {tab === 'add' && <AddTaskTab />}
            {tab === 'report' && <ReportTab />}
          </>
        )}
      </StdbGate>
    </AppShell>
  )
}

function useStepLookup() {
  const [taskRows] = useTable(tables.task)
  return useMemo(() => {
    const steps = new Map<string, Step[]>()
    for (const t of taskRows) {
      try {
        steps.set(t.id, JSON.parse(t.stepsJson))
      } catch {
        steps.set(t.id, [])
      }
    }
    return {
      taskRows,
      steps,
      title: (id: string) => taskRows.find((t) => t.id === id)?.title ?? id,
      stepText: (taskId: string, stepId: number) => steps.get(taskId)?.find((s) => s.id === stepId)?.instruction ?? `Step ${stepId}`,
    }
  }, [taskRows])
}

// ---------------- Help alerts ----------------
function HelpTab() {
  const [help] = useTable(tables.helpRequest)
  const [workers] = useTable(tables.worker)
  const claim = useReducer(reducers.claimHelp)
  const resolve = useReducer(reducers.resolveHelp)
  const { title, stepText } = useStepLookup()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])
  const name = (id: string) => workers.find((w) => w.id === id)?.name ?? id
  const sorted = [...help].sort((a, b) => Number(b.id - a.id))
  const open = sorted.filter((h) => h.status !== 'resolved')
  const done = sorted.filter((h) => h.status === 'resolved').slice(0, 10)
  return (
    <div className="stack" style={{ gap: 14 }}>
      {open.length === 0 && <div className="empty">No one needs help right now.</div>}
      {open.map((h) => (
        <article key={String(h.id)} className={`alert ${h.status === 'open' ? 'alert-open' : ''}`}>
          {h.photo ? <img src={apiUrl(h.photo)} alt={`What ${name(h.workerId)} sees`} /> : <div className="alert-nophoto" aria-hidden />}
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            <div className="spread">
              <strong className="alert-title">{name(h.workerId)} needs help</strong>
              {h.status === 'open' ? <span className="badge-urgent">{ago(h.createdAt.toDate())}</span> : <span className="badge-claimed">{h.claimedBy} is going</span>}
            </div>
            <span className="muted">
              {title(h.taskId)} · {stepText(h.taskId, h.stepId)}
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
      {done.length > 0 && (
        <details className="past">
          <summary>Resolved ({done.length})</summary>
          <ul className="plain-list">
            {done.map((h) => (
              <li key={String(h.id)} className="small">
                <strong>{name(h.workerId)}</strong> · {title(h.taskId)} · {stepText(h.taskId, h.stepId)} <span className="muted">· {h.createdAt.toDate().toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ---------------- Add a task ----------------
const pickMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''

function AddTaskTab() {
  const [job, setJob] = useState<VideoJob | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)
  const file = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    api.videoDemo().then((d) => setDemo(d.available)).catch(() => {})
  }, [])
  useEffect(() => {
    if (!job || job.stage === 'done' || job.stage === 'failed') return
    const t = setTimeout(async () => {
      try {
        const j = await api.videoJob(job.job_id)
        setJob(j)
        if (j.stage === 'done' && j.result) setTasks(j.result.tasks)
        if (j.stage === 'failed') setErr(j.error ?? 'Could not make steps from this video.')
      } catch (e) {
        setErr((e as Error).message)
      }
    }, 1200)
    return () => clearTimeout(t)
  }, [job])
  const run = async (fn: () => Promise<VideoJob>) => {
    setErr(null)
    setTasks(null)
    try {
      setJob(await fn())
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const running = !!job && job.stage !== 'done' && job.stage !== 'failed'

  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="muted">Do the task once in front of the camera and talk through it. Claude turns the video into simple steps.</p>
      <Recorder disabled={running} onDone={(f) => run(() => api.uploadVideo(f))} />
      <div className="row">
        <input
          ref={file}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void run(() => api.uploadVideo(f))
            e.target.value = ''
          }}
        />
        <button className="btn btn-secondary" disabled={running} onClick={() => file.current?.click()}>
          ⬆ Upload a video file
        </button>
        {demo && (
          <button className="btn btn-ghost" disabled={running} onClick={() => run(api.analyzeDemo)}>
            Use the demo video
          </button>
        )}
      </div>
      {err && <p className="note-almost">{err}</p>}
      {running && job && (
        <ol className="stages" aria-live="polite">
          {STAGES.map((s) => {
            const at = STAGES.findIndex((x) => x.key === job.stage)
            const me = STAGES.findIndex((x) => x.key === s.key)
            return (
              <li key={s.key} className={`stage-${me < at ? 'done' : me === at ? 'now' : 'todo'}`}>
                <span className="dot" aria-hidden /> {s.label}
                {job.stages_ms[s.key] !== undefined && <span className="small muted num"> · {fmtLatency(job.stages_ms[s.key])}</span>}
              </li>
            )
          })}
        </ol>
      )}
      {tasks?.map((t) => (
        <section key={t.task_id} className="card stack" style={{ gap: 12 }}>
          <div className="spread">
            <h2 className="section-title" style={{ margin: 0 }}>
              {t.title}
            </h2>
            <Link className="btn btn-primary" to={`/worker/${t.task_id}`}>
              Open as worker →
            </Link>
          </div>
          <ol className="step-list">
            {t.steps.map((s, k) => (
              <li key={s.id} className="step-item">
                <img src={apiUrl(s.reference_photo)} alt={s.done_right} />
                <div className="stack" style={{ gap: 4 }}>
                  <span className="step-n">Step {k + 1}</span>
                  <p className="step-text">{s.instruction}</p>
                  <span className="small muted">If {s.common_mistake.charAt(0).toLowerCase() + s.common_mistake.slice(1)} → “{s.correction}”</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

/** Record a demo with the webcam + mic, preview it, then send it for steps. */
function Recorder({ onDone, disabled }: { onDone: (f: File) => void; disabled: boolean }) {
  const live = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [state, setState] = useState<'idle' | 'preview' | 'recording' | 'review'>('idle')
  const [clip, setClip] = useState<{ url: string; file: File } | null>(null)
  const [secs, setSecs] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }
  useEffect(() => () => stopStream(), [])
  useEffect(() => {
    if (state !== 'recording') return
    const t0 = Date.now()
    const id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [state])

  const open = async () => {
    setErr(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      setState('preview')
      requestAnimationFrame(() => {
        if (live.current) live.current.srcObject = stream.current
      })
    } catch (e) {
      setErr(`Camera or microphone blocked: ${(e as Error).message}`)
    }
  }
  const record = () => {
    if (!stream.current) return
    const mimeType = pickMime()
    chunks.current = []
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined)
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onstop = () => {
      const type = r.mimeType || mimeType || 'video/webm'
      const blob = new Blob(chunks.current, { type })
      const file = new File([blob], `recording.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type })
      setClip({ url: URL.createObjectURL(blob), file })
      setState('review')
      stopStream()
    }
    r.start(1000)
    rec.current = r
    setSecs(0)
    setState('recording')
  }

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <h2 className="section-title" style={{ margin: 0 }}>
        Record a new video
      </h2>
      {(state === 'preview' || state === 'recording') && <video ref={live} className="rec-video" autoPlay muted playsInline />}
      {state === 'review' && clip && <video className="rec-video" src={clip.url} controls playsInline />}
      <div className="row">
        {state === 'idle' && (
          <button className="btn btn-primary" onClick={open} disabled={disabled}>
            📷 Turn on camera
          </button>
        )}
        {state === 'preview' && (
          <button className="btn btn-urgent" onClick={record}>
            ● Start recording
          </button>
        )}
        {state === 'recording' && (
          <>
            <button className="btn btn-primary" onClick={() => rec.current?.stop()}>
              ■ Stop
            </button>
            <span className="rec-dot num">● {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
          </>
        )}
        {state === 'review' && clip && (
          <>
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => {
                onDone(clip.file)
                setState('idle')
              }}
            >
              Make steps from this video
            </button>
            <button className="btn btn-ghost" onClick={() => { setClip(null); void open() }}>
              Record again
            </button>
          </>
        )}
      </div>
      {err && <p className="note-almost">{err}</p>}
      <p className="small muted">Faces are blurred in the photos that are kept. The video is deleted after the steps are made.</p>
    </section>
  )
}

// ---------------- Worker report ----------------
const TREND: Record<string, { label: string; cls: string }> = {
  improving: { label: 'Improving', cls: 'trend-good' },
  steady: { label: 'Steady', cls: 'trend-flat' },
  more_mistakes_lately: { label: 'Needs more support lately', cls: 'trend-watch' },
  not_enough_data: { label: 'Not enough tries yet', cls: 'trend-flat' },
}

function ReportTab() {
  const [workers] = useTable(tables.worker)
  const [sessions] = useTable(tables.session)
  const [events] = useTable(tables.stepEvent)
  const [help] = useTable(tables.helpRequest)
  const { steps, title, stepText } = useStepLookup()
  const [who, setWho] = useState('')
  const [rep, setRep] = useState<WorkerReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const current = who || workers[0]?.id || ''
  const w = workers.find((x) => x.id === current)

  const generate = async () => {
    if (!w) return
    setBusy(true)
    setErr(null)
    setRep(null)
    try {
      const mine = sessions.filter((s) => s.workerId === w.id)
      const body = {
        worker_name: w.name,
        sessions: mine.map((s) => ({ id: s.id, task_id: s.taskId, task_title: title(s.taskId), started_at: s.startedAt.toDate().toISOString(), ended_at: s.endedAt ? s.endedAt.toDate().toISOString() : null, status: s.status, steps_total: steps.get(s.taskId)?.length ?? 0 })),
        events: events
          .filter((e) => e.workerId === w.id && ['done', 'mistake', 'skipped', 'help'].includes(e.kind))
          .map((e) => ({ session_id: e.sessionId, task_id: e.taskId, step_id: e.stepId, step_text: stepText(e.taskId, e.stepId), kind: e.kind, note: e.note, ts: e.ts.toDate().toISOString() })),
        help: help.filter((h) => h.workerId === w.id).map((h) => ({ task_id: h.taskId, step_text: stepText(h.taskId, h.stepId), status: h.status, created_at: h.createdAt.toDate().toISOString(), note: h.note })),
      }
      setRep(await api.report(body))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!workers.length) return <div className="empty">No workers yet. A worker appears here after they start a task.</div>
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row no-print">
        <label htmlFor="who" className="visually-hidden">
          Worker
        </label>
        <select id="who" className="field" value={current} onChange={(e) => { setWho(e.target.value); setRep(null) }}>
          {workers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? 'Writing the report…' : 'Generate report'}
        </button>
        {rep && (
          <button className="btn btn-ghost" onClick={() => window.print()}>
            Print
          </button>
        )}
      </div>
      {err && <p className="note-almost">{err}</p>}
      {rep && <ReportView rep={rep} />}
    </div>
  )
}

function ReportView({ rep }: { rep: WorkerReport }) {
  const s = rep.stats
  const r = rep.report
  return (
    <article className="report card">
      <header className="report-head">
        <div>
          <h2 className="report-title">{rep.worker}</h2>
          <span className="small muted">Report · {new Date(rep.generated_at * 1000).toLocaleString()}</span>
        </div>
        <div className="summary-stats">
          <div>
            <span className="stat-v num">{s.sessions}</span>
            <span className="stat-l">tries</span>
          </div>
          <div>
            <span className="stat-v num">{s.tasks.length}</span>
            <span className="stat-l">tasks</span>
          </div>
          <div>
            <span className="stat-v num">{s.mistakes_total}</span>
            <span className="stat-l">corrections</span>
          </div>
          <div>
            <span className="stat-v num">{s.help_requests}</span>
            <span className="stat-l">help requests</span>
          </div>
        </div>
      </header>

      {!s.sessions && <p className="muted">No sessions recorded for this worker yet.</p>}
      {r && (
        <section className="report-sec">
          <p className="report-summary">{r.summary}</p>
          <div className="report-cols">
            <ReportList title="Strengths" items={r.strengths} />
            <ReportList title="Needs support with" items={r.needs_support} />
          </div>
          <h3>Has it improved?</h3>
          <p>{r.improvement}</p>
          <ReportList title="Next steps for the coach" items={r.recommendations} />
          <div className="for-worker">
            <span className="small muted">To read to {rep.worker}</span>
            <p>{r.for_worker}</p>
          </div>
        </section>
      )}
      {s.sessions > 0 && !r && <p className="note-almost">Claude could not write the summary right now. The measured numbers below are still correct.</p>}

      <section className="report-sec">
        <h3>Tasks</h3>
        <div className="stack" style={{ gap: 14 }}>
          {s.tasks.map((t) => (
            <div key={t.task_id} className="report-task">
              <div className="spread">
                <strong>{t.title}</strong>
                <span className={`trend ${TREND[t.trend].cls}`}>{TREND[t.trend].label}</span>
              </div>
              <span className="small muted">
                Done {t.times_done} {t.times_done === 1 ? 'time' : 'times'}, finished {t.times_finished} · {t.mistakes_total} corrections
              </span>
              <AttemptBars values={t.mistakes_per_attempt} />
              {t.hardest_steps.length > 0 && (
                <span className="small">
                  <span className="muted">Hardest steps:</span> {t.hardest_steps.map((h) => `${h.step} (${h.mistakes})`).join(' · ')}
                </span>
              )}
              {t.attempts.some((a) => a.mistake_notes.length) && (
                <details>
                  <summary className="small">Every correction</summary>
                  <ul className="plain-list small">
                    {t.attempts.flatMap((a, k) => a.mistake_notes.map((n, j) => (
                      <li key={`${k}-${j}`}>
                        Try {k + 1} · {n.step}: <span className="muted">{n.what}</span>
                      </li>
                    )))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
      {rep.notes.length > 0 && (
        <section className="report-sec">
          <h3>Notes remembered about {rep.worker}</h3>
          <ul className="plain-list small">
            {rep.notes.map((n, k) => (
              <li key={k}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      <footer className="small muted">Numbers are measured from this worker's sessions. Words written by Claude{rep.latency_ms ? ` in ${fmtLatency(rep.latency_ms)}` : ''}.</footer>
    </article>
  )
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="dot-list">
        {items.map((x, k) => (
          <li key={k}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

/** Corrections per try, oldest → newest. One series: amber like every mistake in the app; latest value labelled. */
function AttemptBars({ values }: { values: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!values.length) return null
  const max = Math.max(1, ...values)
  const bw = 22
  const gap = 6
  const H = 70 // baseline; the top 14px leave room for the value label
  const W = Math.max(values.length * (bw + gap), 90)
  return (
    <div className="attempts">
      <svg viewBox={`0 0 ${W + 8} ${H + 18}`} width={Math.min(W + 8, 520)} role="img" aria-label={`Corrections per try, oldest first: ${values.join(', ')}`}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" />
        {values.map((v, k) => {
          const h = Math.max(6, (v / max) * (H - 22)) // 4px rounded top; label room above
          const x = k * (bw + gap)
          return (
            <g key={k} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
              <rect x={x - 2} y={0} width={bw + gap} height={H + 18} fill="transparent" />
              {v > 0 ? <path d={`M${x},${H} v${-(h - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${h - 4} z`} style={{ fill: 'var(--almost-fill)', opacity: hover === null || hover === k ? 1 : 0.55 }} /> : <rect x={x} y={H - 2} width={bw} height={2} rx={1} fill="var(--line)" />}
              {(k === values.length - 1 || hover === k) && (
                <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize="11" fill="var(--ink-2)" className="num">
                  {v}
                </text>
              )}
              <title>{`Try ${k + 1}: ${v} correction${v === 1 ? '' : 's'}`}</title>
            </g>
          )
        })}
        {values.length > 1 ? (
          <>
            <text x={0} y={H + 14} fontSize="10" fill="var(--ink-2)">
              oldest
            </text>
            <text x={W} y={H + 14} fontSize="10" fill="var(--ink-2)" textAnchor="end">
              newest
            </text>
          </>
        ) : (
          <text x={0} y={H + 14} fontSize="10" fill="var(--ink-2)">
            1 try
          </text>
        )}
      </svg>
    </div>
  )
}
