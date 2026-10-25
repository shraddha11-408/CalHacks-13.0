import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useReducer, useTable } from 'spacetimedb/react'
import { AppShell } from '../components/AppShell'
import { RaceLog } from '../components/RaceLog'
import { StdbGate } from '../components/Stdb'
import { doubleClaims } from '../lib/claims'
import { useRegisterDevice } from '../lib/device'
import { fmtLatency } from '../format'
import { api, type Step, type Task, type VideoJob } from '../lib/api'
import { apiUrl } from '../lib/audio'
import { getMedia } from '../lib/media'
import { openGlasses, openGlassesMic, type GlassesStream } from '../lib/glasses'
import { reducers, tables } from '../module_bindings'
import { STAGES } from '../lib/stages'
import { levelOf } from '../lib/levels'
import { IncomingCall } from '../components/IncomingCall'
import { StepTimeline, SupportMeter, CorrectionBubble } from '../components/viz'
import { EmptyState } from '../components/States'
import { Dashboard } from '../components/dash/Dashboard'
import '../styles/supervisor.css'

const TABS = [
  { key: 'dash', label: 'Dashboard' },
  { key: 'floor', label: 'Floor' },
  { key: 'help', label: 'Help' },
  { key: 'add', label: 'Add a task' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** /supervisor — dashboard, live floor, help alerts, add a task from a video. */
export function SupervisorHomePage() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab: TabKey = TABS.some((t) => t.key === asked) ? (asked as TabKey) : 'dash'
  const [showTest, setShowTest] = useState(false)
  return (
    <AppShell footer>
      <div className="sv">
      <header className="sv-head">
        <div>
          <p className="eyebrow">DRIGIL · SUPERVISOR</p>
          <h1 className="sv-title">Coach floor</h1>
          <p className="sv-sub">Live view of your workers, help requests and progress.</p>
        </div>
        <label className="sv-test">
          <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
          Include test data
        </label>
      </header>
      <StdbGate>
        {(err) => (
          <>
            <IncomingCall />
            <Tabs tab={tab} onPick={(k) => setParams({ tab: k })} />
            {err && <p className="note-almost">{err}</p>}
            <SupervisorDevice />
            {tab === 'dash' && <DashTab showTest={showTest} />}
            {tab === 'floor' && <Floor showTest={showTest} />}
            {tab === 'help' && <HelpTab showTest={showTest} />}
            {tab === 'add' && <AddTaskTab />}
          </>
        )}
      </StdbGate>
      </div>
    </AppShell>
  )
}

/** Segmented tabs; Help shows the open count with a Sol dot when someone is waiting. */
function Tabs({ tab, onPick }: { tab: TabKey; onPick: (k: TabKey) => void }) {
  const [help] = useTable(tables.helpRequest)
  const open = help.filter((h) => h.status === 'open').length
  return (
    <nav className="sv-tabs" role="tablist" aria-label="Coach floor sections">
      {TABS.map((t) => (
        <button key={t.key} role="tab" aria-selected={tab === t.key} className={`sv-tab ${tab === t.key ? 'on' : ''}`} onClick={() => onPick(t.key)}>
          {t.label}
          {t.key === 'help' && open > 0 && (
            <span className="sv-count num" aria-label={`${open} open`}>
              <span className="sv-sol-dot" aria-hidden />
              {open}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}

/** This screen is a supervisor device: it may change support levels (the reducer checks the role). */
function SupervisorDevice() {
  useRegisterDevice('supervisor', 'Supervisor')
  return null
}

function DashTab({ showTest }: { showTest: boolean }) {
  const { title, stepText, taskRows } = useStepLookup()
  return <Dashboard lookup={{ title, stepText, taskCount: taskRows.length }} showTest={showTest} />
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
      title: (id: string) => taskRows.find((t) => t.id === id)?.title ?? taskName(id),
      stepText: (taskId: string, stepId: number) => steps.get(taskId)?.find((s) => s.id === stepId)?.instruction ?? `${taskRows.find((t) => t.id === taskId)?.title ?? taskName(taskId)} · step ${stepId}`, // task deleted: still say which one
    }
  }, [taskRows])
}

/** A removed task keeps only its id ("put_a_sleeve_on_a_coffee_cup_1792866779"): show it as words. */
const taskName = (id: string) => {
  const s = id.replace(/_\d+$/, '').replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : id
}

// ---------------- Coach floor: one card per live session ----------------
const LIVE_HOURS = 3
/** Test and demo data: workers, tasks and requests made while building drigil. Hidden unless "Include test data" is on. */
const TEST_RE = /test|smoke|speed check|fadetest|agent_smoke|race|esc-test|mobile_test|browser_test/i
const isTest = (...parts: string[]) => parts.some((p) => TEST_RE.test(p))
const since_ = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}
const clock = (d: Date) => {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function useTick(ms: number) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

function Floor({ showTest }: { showTest: boolean }) {
  const [sessions] = useTable(tables.session)
  const [workers] = useTable(tables.worker)
  const [mastery] = useTable(tables.mastery)
  const [talk] = useTable(tables.talkEvent)
  const [help] = useTable(tables.helpRequest)
  const [events] = useTable(tables.stepEvent)
  const setLevel = useReducer(reducers.setSupportLevel)
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const { steps, title } = useStepLookup()
  useTick(15_000)
  // live = unfinished sessions started in the last LIVE_HOURS, newest one per worker
  // (tabs closed without "End task" never end, so old test sessions would pile up here)
  const since = Date.now() - LIVE_HOURS * 3600_000
  const newest = new Map<string, (typeof sessions)[number]>()
  for (const s of sessions) {
    if (s.endedAt || !steps.has(s.taskId) || s.startedAt.toDate().getTime() < since) continue
    if (!showTest && isTest(s.workerId, workers.find((x) => x.id === s.workerId)?.name ?? '', title(s.taskId))) continue
    const cur = newest.get(s.workerId)
    if (!cur || s.startedAt.toDate().getTime() > cur.startedAt.toDate().getTime()) newest.set(s.workerId, s)
  }
  const live = [...newest.values()].sort((a, b) => {
    const an = help.some((h) => h.sessionId === a.id && h.status === 'open') ? 1 : 0
    const bn = help.some((h) => h.sessionId === b.id && h.status === 'open') ? 1 : 0
    return bn - an || b.startedAt.toDate().getTime() - a.startedAt.toDate().getTime()
  })
  if (!live.length) return <EmptyState title="No one is working right now" text="Workers appear here when they start a task." />
  return (
    <>
      {err && <p className="note-almost">{err}</p>}
      <section className="sv-floor" aria-label="Workers on the floor">
        {live.map((s) => {
          const w = workers.find((x) => x.id === s.workerId)
          const nm = w?.name ?? s.workerId
          const st = steps.get(s.taskId) ?? []
          const levels: Record<number, number> = {}
          for (const m of mastery) if (m.workerId === s.workerId && m.taskId === s.taskId) levels[m.stepId] = m.level
          const heard = [...talk].filter((t) => t.sessionId === s.id && t.answer).sort((a, b) => Number(b.id - a.id))[0]
          const needs = help.find((h) => h.sessionId === s.id && h.status === 'open')
          const finished = s.stepIndex >= st.length
          const n = Math.min(s.stepIndex + 1, st.length)
          const cur = st[Math.min(s.stepIndex, st.length - 1)]
          // time on this step = since the last "step done" in this session (or since the session began)
          let last = s.startedAt.toDate()
          for (const e of events) if (e.sessionId === s.id && e.kind === 'done' && e.ts.toDate() > last) last = e.ts.toDate()
          return (
            <article key={s.id} className={`card sv-worker${needs ? ' needs' : ''}`}>
              {needs && (
                <Link className="sv-needs" to="/supervisor?tab=help">
                  {nm} needs help on step {needs.stepId}. Open the request
                </Link>
              )}
              <header className="sv-worker-head">
                <h3 className="sv-name">{nm}</h3>
                <span className="sv-mono num">{finished ? 'Finished' : `Step ${n} of ${st.length}`}</span>
              </header>
              <p className="sv-task">{title(s.taskId)}</p>
              {cur && !finished && (
                <div className="sv-now">
                  {cur.reference_photo ? <img src={apiUrl(cur.reference_photo)} alt={cur.done_right} /> : <div className="sv-now-ph" aria-hidden />}
                  <div className="sv-now-body">
                    <p className="eyebrow">Right now</p>
                    <p className="sv-now-text">{cur.instruction}</p>
                    <p className="sv-facts">
                      <span><b className="num">{since_(last)}</b> on this step</span>
                      <span>Support: <b>{levelOf(levels[cur.id] ?? 0).name}</b></span>
                    </p>
                  </div>
                </div>
              )}
              {finished && <p className="sv-done">Finished the task.</p>}
              <StepTimeline steps={st.map((x) => ({ id: x.id, instruction: x.instruction, photo: x.reference_photo }))} current={s.stepIndex} finished={finished} size="sm" />
              <ul className="sv-levels" aria-label="Support level per step">
                {st.map((x, i) => (
                  // the current step and the next one; the rest sit behind "All steps"
                  <li key={x.id} hidden={!showAll.has(s.id) && (i < s.stepIndex || i > s.stepIndex + 1)}>
                    <span className="sv-lv-step"><span className="num">{i + 1}</span> {x.instruction.replace(/[.!?]+$/, '')}</span>
                    <SupportMeter
                      level={levels[x.id] ?? 0}
                      editable
                      onChange={(lv) => {
                        setErr(null)
                        setLevel({ workerId: s.workerId, taskId: s.taskId, stepId: x.id, level: lv }).catch((e: Error) => setErr(`Could not change the support level: ${e.message}`))
                      }}
                    />
                  </li>
                ))}
              </ul>
              {st.length > 2 && (
                <button className="btn btn-ghost btn-sm sv-all" onClick={() => setShowAll((x) => new Set(x.has(s.id) ? [...x].filter((y) => y !== s.id) : [...x, s.id]))}>
                  {showAll.has(s.id) ? 'Show fewer steps' : `All ${st.length} steps`}
                </button>
              )}
              {heard ? (
                <div className="sv-heard">
                  <p className="eyebrow">{nm} last heard</p>
                  <CorrectionBubble name="Coach" text={heard.answer} />
                </div>
              ) : (
                <p className="small muted">{nm} has not asked the coach anything yet.</p>
              )}
            </article>
          )
        })}
      </section>
    </>
  )
}

// ---------------- Help alerts ----------------
function HelpTab({ showTest }: { showTest: boolean }) {
  const [help] = useTable(tables.helpRequest)
  const [workers] = useTable(tables.worker)
  const [attempts] = useTable(tables.claimAttempt)
  const [routes] = useTable(tables.helpRoute)
  const claim = useReducer(reducers.claimHelp)
  const resolve = useReducer(reducers.resolveHelp)
  const { title, stepText } = useStepLookup()
  useTick(1000)
  const name = (id: string) => workers.find((w) => w.id === id)?.name ?? id
  const shown = help.filter((h) => showTest || !isTest(h.workerId, name(h.workerId), h.taskId))
  const sorted = [...shown].sort((a, b) => Number(b.id - a.id))
  // open first (they are waiting), then claimed (someone is on the way); both newest first
  const open = [...sorted.filter((h) => h.status === 'open'), ...sorted.filter((h) => h.status === 'claimed')]
  const today = new Date().toDateString()
  const done = sorted.filter((h) => h.status === 'resolved' && h.createdAt.toDate().toDateString() === today).slice(0, 20)
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="sv-sub">Requests go to help buddies' phones first, then to you. The first person to answer gets it.</p>
      {open.length === 0 && <EmptyState title="No one needs help right now" text="Help requests from workers appear here the moment they are sent." />}
      {open.map((h) => {
        const route = routes.find((r) => r.helpId === h.id)?.routedTo
        const isOpen = h.status === 'open'
        return (
          <article key={String(h.id)} className={`card sv-alert ${isOpen ? 'sv-alert-open' : ''}`}>
            {h.photo ? <img src={apiUrl(h.photo)} alt={`What ${name(h.workerId)} sees`} /> : <div className="alert-nophoto" aria-hidden />}
            <div className="stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
              <div className="spread">
                <strong className="sv-alert-title">{name(h.workerId)} {isOpen ? 'needs a hand' : 'has help coming'}</strong>
                <span className="sv-wait num" aria-label="Waiting time">{isOpen ? `Waiting ${clock(h.createdAt.toDate())}` : `${h.claimedBy} is going`}</span>
              </div>
              <span className="sv-where">
                {title(h.taskId)} · step <span className="num">{h.stepId}</span>: {stepText(h.taskId, h.stepId)}
              </span>
              {isOpen && (
                <span className="small">
                  {route === 'supervisor' ? (
                    <strong>No buddy answered in <span className="num">20 s</span>, so it came to you.</strong>
                  ) : (
                    <span className="muted">Sent to help buddies first. It comes to you if nobody answers in <span className="num">20 s</span>.</span>
                  )}
                </span>
              )}
              <div className="row">
                {isOpen ? (
                  <button className="btn-sol" onClick={() => claim({ id: h.id, by: 'Supervisor' }).catch(() => {})}>
                    I'll help
                  </button>
                ) : (
                  <button className="btn-outline" onClick={() => resolve({ id: h.id, note: 'Helped in person' }).catch(() => {})}>
                    Mark resolved
                  </button>
                )}
              </div>
              <RaceLog attempts={attempts.filter((a) => a.helpId === h.id)} me="Supervisor" />
            </div>
          </article>
        )
      })}
      {done.length > 0 && (
        <details className="past card sv-past">
          <summary>Earlier today{' '}<span className="num">({done.length})</span></summary>
          <ul className="plain-list">
            {done.map((h) => (
              <li key={String(h.id)} className="small">
                <strong>{name(h.workerId)}</strong> · {title(h.taskId)} · {stepText(h.taskId, h.stepId)} <span className="muted num">· {h.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="sv-mono sv-foot num">Claim race · double-claims {doubleClaims(attempts)}</p>
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
  const [cloneOk, setCloneOk] = useState(false)
  const [who, setWho] = useState('')
  const consentBy = cloneOk && who.trim() ? who.trim() : ''
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
    <div className="stack sv-add" style={{ gap: 16 }}>
      <p className="sv-sub">Do the task once in front of the camera and talk through it. Claude turns the video into simple steps.</p>

      <section className="card sv-step" aria-labelledby="add1">
        <header className="sv-step-head">
          <span className="sv-step-n num" aria-hidden>1</span>
          <div>
            <h2 id="add1" className="sv-step-title">Choose the coach's voice</h2>
            <p className="small muted">Optional. Skip this to use the standard coach voice.</p>
          </div>
        </header>
        <label className="sv-consent">
          <input type="checkbox" checked={cloneOk} onChange={(e) => setCloneOk(e.target.checked)} />
          <span>
            <strong>Yes, use my voice.</strong> I agree that drigil may copy my voice from this video (Cartesia voice cloning). It will only speak the
            instructions for these tasks. I can ask for it to be deleted at any time.
          </span>
        </label>
        {cloneOk && <input className="field" placeholder="Type your full name to give consent" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Your full name" />}
        {cloneOk && !who.trim() && <span className="small muted">Type your name to turn on voice cloning.</span>}
        {consentBy && <span className="small sv-ok">Consent recorded for {consentBy}.</span>}
      </section>

      <section className="card sv-step" aria-labelledby="add2">
        <header className="sv-step-head">
          <span className="sv-step-n num" aria-hidden>2</span>
          <div>
            <h2 id="add2" className="sv-step-title">Show the task</h2>
            <p className="small muted">Record it now, or upload a video you already have.</p>
          </div>
        </header>
        <Recorder disabled={running} onDone={(f) => run(() => api.uploadVideo(f, consentBy))} />
        <div className="row sv-or">
          <input
            ref={file}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void run(() => api.uploadVideo(f, consentBy))
              e.target.value = ''
            }}
          />
          <button className="btn btn-secondary" disabled={running} onClick={() => file.current?.click()}>
            Upload a video file
          </button>
          {demo && (
            <button className="btn btn-ghost" disabled={running} onClick={() => run(() => api.analyzeDemo(consentBy))}>
              Use the demo video
            </button>
          )}
        </div>
      </section>

      <section className="card sv-step" aria-labelledby="add3">
        <header className="sv-step-head">
          <span className="sv-step-n num" aria-hidden>3</span>
          <div>
            <h2 id="add3" className="sv-step-title">Check the steps</h2>
            <p className="small muted">{running ? 'Making your steps. This takes a minute.' : tasks?.length ? 'Read the steps, then open the task as a worker to try it.' : 'Your steps show up here after Claude watches the video.'}</p>
          </div>
        </header>
      {err && <p className="note-almost">{err}</p>}
      {job?.voice_error && <p className="note-almost">{job.voice_error}</p>}
      {running && job && (
        <ol className="stages" aria-live="polite">
          {STAGES.filter((s) => s.key !== 'cloning_voice' || consentBy).map((s) => {
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
      {tasks?.length === 0 && (
        <section className="card stack" style={{ gap: 6 }} role="status">
          <strong>No task found in this video.</strong>
          <span>
            Show the whole task with your hands on the table, and say each step out loud as you do it. A video of a minute or so works
            best.
          </span>
          {job?.result?.transcript_clean && <span className="small muted">What we heard: “{job.result.transcript_clean}”</span>}
        </section>
      )}
      {tasks?.map((t) => (
        <section key={t.task_id} className="sv-made stack" style={{ gap: 12 }}>
          <div className="spread">
            <h3 className="sv-made-title">{t.title}</h3>
            <Link className="btn btn-primary" to={`/worker/${t.task_id}`}>
              Open as worker
            </Link>
          </div>
          <span className="small muted">{t.voice ? `Instructions in ${t.voice.name}'s voice (cloned with consent).` : 'Instructions in the standard coach voice.'}</span>
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
      </section>
    </div>
  )
}

const REC_CAM_KEY = 'stepwise-rec-camera'

/** Record a demo with the laptop camera + mic, or the glasses camera + mic, preview it, then send it for steps. */
function Recorder({ onDone, disabled }: { onDone: (f: File) => void; disabled: boolean }) {
  const live = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const glasses = useRef<GlassesStream | null>(null)
  const glassesMic = useRef<GlassesStream | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [source, setSource] = useState<'laptop' | 'glasses'>(() => {
    try {
      return localStorage.getItem(REC_CAM_KEY) === 'glasses' ? 'glasses' : 'laptop'
    } catch {
      return 'laptop'
    }
  })
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [state, setState] = useState<'idle' | 'preview' | 'recording' | 'review'>('idle')
  const [clip, setClip] = useState<{ url: string; file: File } | null>(null)
  const [secs, setSecs] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  const stopStream = () => {
    glasses.current?.stop()
    glasses.current = null
    glassesMic.current?.stop()
    glassesMic.current = null
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
    setNote(null)
    try {
      if (source === 'glasses') {
        // glasses picture + the glasses mic (Brio 100 on the Pi), near the wearer's mouth
        const [cam, mic] = await Promise.allSettled([openGlasses(), openGlassesMic()])
        if (cam.status === 'rejected') {
          if (mic.status === 'fulfilled') mic.value.stop()
          throw cam.reason
        }
        glasses.current = cam.value
        let audio: MediaStreamTrack[]
        if (mic.status === 'fulfilled') {
          glassesMic.current = mic.value
          audio = mic.value.stream.getAudioTracks()
        } else {
          // the picture works but the glasses mic doesn't: record anyway, with the laptop mic, and say so
          audio = (await getMedia({ audio: true })).getAudioTracks()
          setNote(`${(mic.reason as Error).message} Recording with the laptop mic instead.`)
        }
        stream.current = new MediaStream([...cam.value.stream.getVideoTracks(), ...audio])
      } else {
        stream.current = await getMedia({ video: { width: 1280, height: 720 }, audio: true })
      }
      setState('preview')
      requestAnimationFrame(() => {
        if (live.current) live.current.srcObject = stream.current
      })
    } catch (e) {
      const m = (e as Error).message
      setErr(m.startsWith('Glasses camera') ? `${m} Or record with the laptop camera.` : `Camera or microphone blocked: ${m}`)
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
    <div className="stack" style={{ gap: 12 }}>
      {(state === 'preview' || state === 'recording') && <video ref={live} className="rec-video" autoPlay muted playsInline />}
      {state === 'review' && clip && <video className="rec-video" src={clip.url} controls playsInline />}
      <div className="row">
        {state === 'idle' && (
          <>
            <button className="btn btn-primary" onClick={open} disabled={disabled}>
              Turn on camera
            </button>
            <label className="row small" style={{ gap: 6 }}>
              Camera
              <select
                className="search"
                style={{ width: 'auto', minHeight: 40, padding: '4px 8px' }}
                value={source}
                onChange={(e) => {
                  const v = e.target.value === 'glasses' ? 'glasses' : 'laptop'
                  setSource(v)
                  try {
                    localStorage.setItem(REC_CAM_KEY, v)
                  } catch {
                    /* ok */
                  }
                }}
              >
                <option value="laptop">Laptop camera</option>
                <option value="glasses">Glasses (Pi)</option>
              </select>
            </label>
          </>
        )}
        {state === 'preview' && (
          <button className="btn btn-urgent" onClick={record}>
            Start recording
          </button>
        )}
        {state === 'recording' && (
          <>
            <button className="btn btn-primary" onClick={() => rec.current?.stop()}>
              Stop
            </button>
            <span className="rec-dot num">REC {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
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
      {note && <p className="small muted">{note}</p>}
      <p className="small muted">Faces are blurred in the photos that are kept. The video is deleted after the steps are made.</p>
    </div>
  )
}
