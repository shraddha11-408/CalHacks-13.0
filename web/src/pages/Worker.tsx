import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LiveCheck, type LoggedMistake } from '../components/LiveCheck'
import { CaptionBar, StepDots } from '../components/ui'
import { api, type PublicConfig, type StepPayload, type Task } from '../lib/api'
import { AudioQueue, apiUrl, type Say } from '../lib/audio'
import { grab, snapshot } from '../lib/vision'

const NAME_KEY = 'stepwise-worker'
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
const ttsUrl = (text: string) => `/tts?text=${encodeURIComponent(text)}`
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Who is working. Kept on this device so reports group by the same name. */
function NameGate({ children }: { children: (name: string, change: () => void) => ReactNode }) {
  const [name, setName] = useState(readName)
  const [draft, setDraft] = useState('')
  if (name) return <>{children(name, () => setName(''))}</>
  return (
    <form
      className="name-gate"
      onSubmit={(e) => {
        e.preventDefault()
        const n = draft.trim()
        if (!n) return
        try {
          localStorage.setItem(NAME_KEY, n)
        } catch {
          /* ok */
        }
        setName(n)
      }}
    >
      <label htmlFor="worker-name" className="big-label">
        What is your name?
      </label>
      <input id="worker-name" className="field field-xl" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your name" />
      <button className="btn btn-primary btn-xl" disabled={!draft.trim()}>
        Go
      </button>
    </form>
  )
}

/** /worker — "View my tasks". */
export function WorkerPage() {
  const [tasks, setTasks] = useState<{ task_id: string; title: string; steps: number }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.tasks().then(setTasks).catch((e) => setErr(e.message))
  }, [])
  return (
    <AppShell back={{ to: '/choose', label: 'Back' }}>
      <NameGate>
        {(name, change) => (
          <div className="stack" style={{ gap: 20 }}>
            <div className="spread">
              <h1 className="app-title" style={{ margin: 0 }}>
                Hi, {name}
              </h1>
              <button className="btn btn-ghost" onClick={change}>
                Not {name}?
              </button>
            </div>
            <h2 className="section-title">My tasks</h2>
            {err && <p className="note-almost">{err}</p>}
            {tasks === null && !err && <p className="muted">Loading…</p>}
            {tasks?.length === 0 && <p className="muted">No tasks yet. Ask your supervisor to add one.</p>}
            <div className="task-list">
              {tasks?.map((t) => (
                <Link key={t.task_id} to={`/worker/${t.task_id}`} className="task-row">
                  <span className="task-row-title">{t.title}</span>
                  <span className="muted">{t.steps} steps →</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </NameGate>
    </AppShell>
  )
}

type Phase = 'overview' | 'running' | 'summary'

/** /worker/:taskId — the steps, then the camera, then the mistake log. */
export function WorkerTaskPage() {
  const { taskId } = useParams()
  return <WorkerTask key={taskId} taskId={taskId!} />
}

function WorkerTask({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Task | null>(null)
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [phase, setPhase] = useState<Phase>('overview')
  const [i, setI] = useState(0)
  const [sid, setSid] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<LoggedMistake[]>([])
  const [finished, setFinished] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [endedAt, setEndedAt] = useState(0)
  const [caption, setCaption] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [helpSent, setHelpSent] = useState(false)
  const audio = useRef<AudioQueue | null>(null)
  const sidRef = useRef<string | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const quietNext = useRef(false)

  useEffect(() => {
    audio.current = new AudioQueue()
    audio.current.onCaption = (t, s) => {
      if (t) setCaption(t)
      setSpeaking(s)
    }
    api.config().then(setCfg).catch(() => {})
    api.task(taskId).then(setTask).catch((e) => setErr(e.message))
    return () => {
      audio.current?.stop()
      if (sidRef.current) void api.end(sidRef.current)
    }
  }, [taskId])

  const say = useCallback((text: string) => audio.current?.play([{ text, url: ttsUrl(text) }]), [])
  const playSay = useCallback((items: Say[]) => audio.current?.play(items), [])
  const step = task?.steps[i]

  // speak each new step while running (a live "done" already spoke "Great!" + the next step)
  useEffect(() => {
    if (quietNext.current) {
      quietNext.current = false
      return
    }
    if (phase === 'running' && step) say(step.instruction)
  }, [phase, step, say])

  const finish = useCallback((complete: boolean) => {
    if (sidRef.current) void api.end(sidRef.current)
    sidRef.current = null
    setSid(null)
    setFinished(complete)
    setEndedAt(Date.now())
    setPhase('summary')
  }, [])

  const start = async () => {
    if (!task) return
    setErr(null)
    setMistakes([])
    setHelpSent(false)
    setI(0)
    try {
      const r = await api.start(readName() || 'Worker', task.task_id)
      sidRef.current = r.session_id
      setSid(r.session_id)
      setStartedAt(Date.now())
      setPhase('running')
    } catch (e) {
      setErr(`The camera check could not start: ${(e as Error).message}`)
    }
  }

  const onLiveStep = useCallback((p: StepPayload) => {
    quietNext.current = true
    setI(p.index)
  }, [])
  const onLiveFinished = useCallback(() => {
    quietNext.current = true
    finish(true)
  }, [finish])
  const onMistake = useCallback((m: LoggedMistake) => setMistakes((xs) => [...xs, m]), [])

  const go = (d: number) => {
    if (!task) return
    if (i + d >= task.steps.length) {
      say('You did every step. Great work!')
      finish(true)
      return
    }
    const next = Math.max(0, i + d)
    setI(next)
    if (sidRef.current) void api.goto(sidRef.current, next).catch(() => {})
  }

  const help = async () => {
    if (!sidRef.current) return
    let image: string | null = null
    try {
      if (video.current) image = (await snapshot(grab(video.current), { x: 0, y: 0, w: 1, h: 1 }, 512)).jpeg
    } catch {
      /* send without a photo */
    }
    try {
      const r = await api.help(sidRef.current, image)
      playSay(r.say)
      setHelpSent(true)
    } catch (e) {
      setErr(`Help could not be sent: ${(e as Error).message}`)
    }
  }

  if (!task) {
    return (
      <AppShell back={{ to: '/worker', label: 'My tasks' }}>
        <p className="muted">{err ?? 'Loading…'}</p>
      </AppShell>
    )
  }

  return (
    <AppShell back={phase === 'running' ? undefined : { to: '/worker', label: 'My tasks' }}>
      {err && <p className="note-almost">{err}</p>}

      {phase === 'overview' && (
        <div className="stack" style={{ gap: 22 }}>
          <div>
            <h1 className="app-title">{task.title}</h1>
            <p className="muted">{task.steps.length} steps. Look at them, then press Start.</p>
          </div>
          <ol className="step-list">
            {task.steps.map((s, k) => (
              <li key={s.id} className="step-item">
                <img src={apiUrl(s.reference_photo)} alt={s.done_right} />
                <div className="stack" style={{ gap: 4 }}>
                  <span className="step-n">Step {k + 1}</span>
                  <p className="step-text">{s.instruction}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => say(s.instruction)}>
                    🔊 Hear it
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button className="btn btn-primary btn-xl btn-block" onClick={start} disabled={!cfg}>
            📷 Start task
          </button>
          <p className="small muted center">The camera turns on. Your face is blurred, and no video is saved.</p>
        </div>
      )}

      {phase === 'running' && step && sid && cfg && (
        <div className="run">
          <div className="run-main stack" style={{ gap: 14 }}>
            <div className="spread">
              <span className="step-n">
                Step {i + 1} of {task.steps.length}
              </span>
              <StepDots total={task.steps.length} current={i} />
            </div>
            <p className="run-instruction">{step.instruction}</p>
            <LiveCheck cfg={cfg} sessionId={sid} onSay={playSay} onStep={onLiveStep} onFinished={onLiveFinished} onMistake={onMistake} videoRef={video} />
            <div className="row">
              <button className="btn btn-secondary" onClick={() => say(step.instruction)}>
                🔊 Hear it
              </button>
              <button className="btn btn-secondary" onClick={() => go(-1)} disabled={i === 0}>
                ← Back
              </button>
              <button className="btn btn-secondary" onClick={() => go(1)}>
                {i === task.steps.length - 1 ? 'I finished ✓' : 'Next →'}
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-urgent" onClick={help} disabled={helpSent}>
                {helpSent ? 'Help is coming' : '✋ I need help'}
              </button>
              <button className="btn btn-ghost" onClick={() => finish(false)}>
                End task
              </button>
            </div>
          </div>
          <aside className="run-side stack" style={{ gap: 12 }}>
            <figure className="ref-card">
              <img src={apiUrl(step.reference_photo)} alt={step.done_right} />
              <figcaption>Done right looks like this</figcaption>
            </figure>
            <MistakeLog task={task} mistakes={mistakes} startedAt={startedAt} live />
          </aside>
        </div>
      )}

      {phase === 'summary' && (
        <div className="stack" style={{ gap: 22 }}>
          <div className="summary-head">
            <h1 className="app-title">{finished ? 'You finished! Great work.' : 'Task stopped'}</h1>
            <div className="summary-stats">
              <div>
                <span className="stat-v num">{clock(endedAt - startedAt)}</span>
                <span className="stat-l">time</span>
              </div>
              <div>
                <span className="stat-v num">{finished ? task.steps.length : i}</span>
                <span className="stat-l">of {task.steps.length} steps done</span>
              </div>
              <div>
                <span className="stat-v num">{mistakes.length}</span>
                <span className="stat-l">{mistakes.length === 1 ? 'thing to fix' : 'things to fix'}</span>
              </div>
            </div>
          </div>
          <MistakeLog task={task} mistakes={mistakes} startedAt={startedAt} />
          <div className="row">
            <button className="btn btn-primary btn-xl" onClick={start}>
              Do it again
            </button>
            <Link className="btn btn-secondary btn-xl" to="/worker">
              My tasks
            </Link>
          </div>
        </div>
      )}
      {phase !== 'overview' && <CaptionBar text={caption || ' '} speaking={speaking} />}
    </AppShell>
  )
}

/** Every correction, in order: which step, what was seen, what to do instead. */
function MistakeLog({ task, mistakes, startedAt, live = false }: { task: Task; mistakes: LoggedMistake[]; startedAt: number; live?: boolean }) {
  return (
    <section className="mlog" aria-live={live ? 'polite' : undefined}>
      <h2 className="section-title">{live ? `Things to fix · ${mistakes.length}` : 'Mistake log'}</h2>
      {mistakes.length === 0 ? (
        <p className="muted small">{live ? 'Nothing yet. Keep going!' : 'No mistakes this time.'}</p>
      ) : (
        <ol className="mlog-list">
          {mistakes.map((m, k) => (
            <li key={k} className="mlog-item">
              {m.photo && !live ? <img src={apiUrl(m.photo)} alt="" /> : null}
              <div className="stack" style={{ gap: 2 }}>
                <span className="small muted num">
                  {clock(m.at - startedAt)} · Step {m.stepIndex + 1}: {task.steps[m.stepIndex]?.instruction ?? ''}
                </span>
                <span>
                  <span className="tag-almost">Almost</span> {m.what}
                </span>
                {m.fix && (
                  <span>
                    <span className="tag-do">Do this</span> {m.fix}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
