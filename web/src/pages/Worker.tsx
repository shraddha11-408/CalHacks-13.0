import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LiveCheck, type LoggedMistake } from '../components/LiveCheck'
import { StdbGate } from '../components/Stdb'
import { WristButton } from '../components/WristButton'
import { WorkerFading, type LevelChangeEvent } from '../components/WorkerFading'
import { levelOf } from '../lib/levels'
import { CaptionBar } from '../components/ui'
import { CorrectionBubble, StatCard, StepTimeline, SupportChip, type TimelineStep } from '../components/viz'
import { EmptyState, ErrorNote, Loading } from '../components/States'
import { api, type Progress, type PublicConfig, type StepPayload, type TalkResult, type Task } from '../lib/api'
import { AudioQueue, apiUrl, type Say, type SpeechKind } from '../lib/audio'
import { Listener, type ListenPhase } from '../lib/listen'
import { grab, snapshot } from '../lib/vision'
import { useEdgeEvents } from '../edge'

const NAME_KEY = 'stepwise-worker'
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
// Times this worker finished each task on this device (a per-device convenience for the task list).
const DONE_KEY = 'stepwise-done'
const readDone = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}
const markDone = (taskId: string) => {
  try {
    const d = readDone()
    d[taskId] = (d[taskId] ?? 0) + 1
    localStorage.setItem(DONE_KEY, JSON.stringify(d))
  } catch {
    /* ok */
  }
}
const ttsUrl = (text: string, voice?: string) => `/tts?text=${encodeURIComponent(text)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}`
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
      <label htmlFor="worker-name" className="big-label wk-display">
        Hi! What is your name?
      </label>
      <input id="worker-name" className="field field-xl" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your name" />
      <button className="btn btn-primary btn-xl" disabled={!draft.trim()}>
        Start
      </button>
      <p className="wk-caption">Your coach set up your tasks.</p>
    </form>
  )
}

// ---- worker home: "my workday" ----
type Place = 'Café' | 'Store' | 'Stockroom' | 'Other'
const PLACES: Place[] = ['Café', 'Store', 'Stockroom', 'Other']
const PLACE_LABEL: Record<Place, string> = { Café: 'Café', Store: 'Store', Stockroom: 'Stockroom', Other: 'More tasks' }
type HomeTask = { task_id: string; title: string; steps: number; place: Place; cover?: string; minutes?: number }
type Extra = Task & { place?: string; cover_photo?: string; minutes?: number }

const asPlace = (p: string | undefined): Place => (PLACES.includes(p as Place) ? (p as Place) : 'Café')

// Demo: the "Next up" card is always the coffee-sleeve task, with the founder's cover photo
// (null = fall back to the task's first step photo).
const SLEEVE_COVER: string | null = '/media/sleeve-cover.jpg'
const SLEEVE_TITLE = 'Put sleeves on coffee cups'
// "My tasks": exactly these three, in this order (made by scripts/seed_example_tasks.py).
const MY_TASK_IDS = ['example_clean_coffee_machine', 'example_venti_americano', 'example_strawberry_matcha']
// Cover photos for "My tasks" (first-person, public/media).
const MY_TASK_COVERS: Record<string, string> = {
  example_clean_coffee_machine: '/media/clean-machine.jpg',
  example_venti_americano: '/media/venti-americano.jpg',
  example_strawberry_matcha: '/media/strawberry-matcha.jpg',
}

// Status from how many times this worker finished the task on this device.
const statusOf = (n: number) =>
  n >= 3 ? { key: 'own', label: 'I can do it', help: 'A little help', fill: 1 } : n >= 1 ? { key: 'practicing', label: 'Practicing', help: 'Some help', fill: 2 } : { key: 'new', label: 'New', help: 'Full help', fill: 3 }

function PlaceIcon({ place }: { place: Place }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
      {place === 'Café' && <g {...p}><path d="M10 18h24v10a10 10 0 0 1-10 10h-4a10 10 0 0 1-10-10z" /><path d="M34 21h3a5 5 0 0 1 0 10h-3" /><path d="M17 8c-2 3 2 4 0 7M25 8c-2 3 2 4 0 7" /></g>}
      {place === 'Store' && <g {...p}><path d="M8 14h32M8 26h32M8 38h32" /><rect x="12" y="6" width="6" height="8" rx="2" /><rect x="22" y="18" width="6" height="8" rx="2" /><rect x="30" y="30" width="6" height="8" rx="2" /></g>}
      {place === 'Stockroom' && <g {...p}><path d="M8 16l16-8 16 8v18l-16 8-16-8z" /><path d="M8 16l16 8 16-8M24 24v18" /></g>}
      {place === 'Other' && <g {...p}><rect x="10" y="8" width="28" height="34" rx="4" /><path d="M17 18h14M17 26h14M17 34h8" /></g>}
    </svg>
  )
}

/** A task photo, or a calm placeholder in the place's color when the photo hasn't come yet. */
function TaskPhoto({ task, big = false }: { task: HomeTask; big?: boolean }) {
  const [broken, setBroken] = useState(false)
  const cls = `wh-photo wh-place-${task.place.toLowerCase()}${big ? ' big' : ''}`
  if (task.cover && !broken) return <img className={cls} src={task.cover} alt="" onError={() => setBroken(true)} />
  return (
    <span className={`${cls} wh-photo-empty`} aria-hidden="true">
      <PlaceIcon place={task.place} />
    </span>
  )
}

function HelpMeter({ fill, label }: { fill: number; label: string }) {
  return (
    <span className="wh-help" aria-label={`Help: ${label}`}>
      <span className="wh-help-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => <span key={i} className={i <= fill ? 'on' : ''} />)}
      </span>
      <span>{label}</span>
    </span>
  )
}

/** /worker — "My workday". */
export function WorkerPage() {
  const [tasks, setTasks] = useState<HomeTask[] | null>(null)
  const [next, setNext] = useState<HomeTask | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done] = useState(readDone)
  useEffect(() => {
    api
      .tasks()
      .then(async (list) => {
        const toHome = (t: { task_id: string; title: string; steps: number }, f: Extra | null, cover?: string): HomeTask => ({
          task_id: t.task_id, title: t.title, steps: t.steps, place: asPlace(f?.place), cover, minutes: f?.minutes,
        })
        // My tasks: the three Café tasks, in order.
        const mine = MY_TASK_IDS.map((id) => list.find((t) => t.task_id === id)).filter((t): t is NonNullable<typeof t> => !!t)
        const mineFull = await Promise.all(mine.map((t) => api.task(t.task_id).then((x) => x as Extra).catch(() => null)))
        setTasks(mine.map((t, i) => toHome(t, mineFull[i], MY_TASK_COVERS[t.task_id] ?? (mineFull[i]?.cover_photo || undefined))))
        // Next up: the newest coffee-sleeve task whose steps have reference photos (the list is newest first).
        const sleeves = list.filter((t) => /sleeve/i.test(t.title) && !t.task_id.startsWith('example_'))
        const full = await Promise.all(sleeves.map((t) => api.task(t.task_id).then((x) => x as Extra).catch(() => null)))
        const i = full.findIndex((f) => f?.steps.some((s) => s.reference_photo))
        const k = i >= 0 ? i : 0
        if (sleeves[k]) {
          const stepPhoto = full[k]?.steps.find((s) => s.reference_photo)?.reference_photo
          const cover = SLEEVE_COVER ?? (stepPhoto ? apiUrl(stepPhoto) : undefined) // local /media path, no /api prefix
          setNext({ ...toHome(sleeves[k], full[k]), title: SLEEVE_TITLE, place: 'Café', cover })
        }
      })
      .catch((e) => setErr(e.message))
  }, [])
  const timesDone = Object.values(done).reduce((a, b) => a + b, 0)
  const own = tasks?.filter((t) => (done[t.task_id] ?? 0) >= 3).length ?? 0
  return (
    <AppShell back={{ to: '/choose', label: 'Back' }}>
      <NameGate>
        {(name, change) => (
          <div className="wk wh">
            <header className="wh-head">
              <div>
                <p className="eyebrow">My workday</p>
                <h1 className="wk-display">Hi, {name}!</h1>
              </div>
              <button className="btn btn-ghost wk-btn" onClick={change}>
                Not {name}?
              </button>
            </header>
            {err && <ErrorNote text="We could not load your tasks. Try again." onRetry={() => location.reload()} />}
            {tasks === null && !err && <Loading lines={3} label="Loading your tasks" />}
            {tasks && tasks.length === 0 && !next && <EmptyState title="No tasks yet." text="Your coach will add a task for you." />}

            {next && (
              <section className="wh-next card" aria-labelledby="wh-next-title">
                <TaskPhoto task={next} big />
                <div className="wh-next-body">
                  <p className="eyebrow">Next up</p>
                  <h2 id="wh-next-title" className="wh-next-title">{next.title}</h2>
                  <p className="wh-facts">
                    <span>{PLACE_LABEL[next.place]}</span>
                    <span className="wk-mono">{next.steps} steps</span>
                    {next.minutes ? <span className="wk-mono">About {next.minutes} min</span> : null}
                  </p>
                  <Link to={`/worker/${next.task_id}`} className="btn btn-primary btn-xl wh-start">
                    Start
                  </Link>
                </div>
              </section>
            )}

            {Boolean(tasks?.length || next) && (
              <section className="wh-prog card" aria-label="My progress">
                <p className="wh-prog-line">
                  {timesDone === 0 ? 'Your first task is waiting. You can do it.' : own > 0 ? `You can do ${own} ${own === 1 ? 'task' : 'tasks'} on your own. Great work!` : `You finished a task ${timesDone === 1 ? 'one time' : `${timesDone} times`}. Keep going!`}
                </p>
                <p className="wk-caption">It's OK to ask. Your coach is here.</p>
              </section>
            )}

            {tasks && tasks.length > 0 && (
              <section className="stack" style={{ gap: 18 }} aria-labelledby="wh-all">
                <h2 id="wh-all" className="wh-h2">My tasks</h2>
                <ul className="wh-grid">
                  {tasks.map((t) => {
                    const st = statusOf(done[t.task_id] ?? 0)
                    return (
                      <li key={t.task_id}>
                        <Link to={`/worker/${t.task_id}`} className="wh-card card">
                          <TaskPhoto task={t} />
                          <span className="wh-card-body">
                            <span className="wh-card-title">{t.title}</span>
                            <span className={`wk-pill ${st.key === 'new' ? '' : 'practicing'}`}>{st.label}</span>
                            <HelpMeter fill={st.fill} label={st.help} />
                            <span className="wk-mono">{t.steps} steps{t.minutes ? ` · ${t.minutes} min` : ''}</span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section className="wh-helpbox card" aria-labelledby="wh-help-title">
              <div className="stack" style={{ gap: 6 }}>
                <h2 id="wh-help-title" className="wh-h2">Need help?</h2>
                <p className="wk-lede">Press your wristband. Your supervisor will come.</p>
              </div>
              <WristButton sessionId={null} workerName={name} />
            </section>
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
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [listen, setListen] = useState<ListenPhase>('off')
  const [chat, setChat] = useState<{ said: string; answer: string }[]>([])
  const [thinking, setThinking] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [workerId, setWorkerId] = useState('')
  const [levels, setLevels] = useState<Record<number, number>>({})
  const [levelUp, setLevelUp] = useState<{ text: string; at: number } | null>(null)
  const [demoVideo, setDemoVideo] = useState<File | null>(null) // demo: a recorded video plays in place of the camera
  const thinkingRef = useRef(false)
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
    api.config(taskId).then(setCfg).catch(() => {})
    api.task(taskId).then(setTask).catch((e) => setErr(e.message))
    api.workerId(readName() || 'Worker').then((r) => setWorkerId(r.worker_id)).catch(() => {})
    return () => {
      audio.current?.stop()
      if (sidRef.current) void api.end(sidRef.current)
    }
  }, [taskId])

  // the worker pressed a button: always say it
  const voiceId = task?.voice?.id ?? cfg?.voice_id ?? undefined // always the cloned voice
  const voiceRef = useRef(voiceId)
  voiceRef.current = voiceId
  const say = useCallback((text: string) => audio.current?.say([{ text, url: ttsUrl(text, voiceId) }], 'answer', { force: true }), [voiceId])
  const playSay = useCallback((items: Say[], kind: SpeechKind) => audio.current?.say(items, kind), [])
  const step = task?.steps[i]
  // a quiet "Step N done" badge each time a step is finished while running (no sound: the backend praises)
  const [cheer, setCheer] = useState<{ n: number; at: number } | null>(null)
  const prevI = useRef(0)
  useEffect(() => {
    if (phase === 'running' && i > prevI.current) setCheer({ n: prevI.current + 1, at: Date.now() })
    prevI.current = i
  }, [i, phase])
  useEffect(() => {
    if (!cheer) return
    const t = window.setTimeout(() => setCheer(null), 2600)
    return () => window.clearTimeout(t)
  }, [cheer])

  // speak each new step while running (a live "done" already spoke "Great!" + the next step)
  useEffect(() => {
    if (quietNext.current) {
      quietNext.current = false
      return
    }
    if (phase === 'running' && step) audio.current?.say([{ text: step.instruction, url: ttsUrl(step.instruction, voiceRef.current) }], 'advance', { force: true })
    // voiceId is read through a ref: config arriving late must not re-speak the step in a second voice
  }, [phase, step])

  const finish = useCallback((complete: boolean) => {
    const id = sidRef.current
    if (id) {
      // progress you can hear: SpacetimeDB numbers + a Moss detail, spoken after "You did every step"
      setProgress(null)
      void api
        .end(id)
        .then(() => api.progress(id))
        .then((p) => {
          setProgress(p)
          audio.current?.say(p.say, 'answer', { force: true })
        })
        .catch(() => {})
    }
    sidRef.current = null
    setSid(null)
    setFinished(complete)
    if (complete) markDone(taskId)
    setEndedAt(Date.now())
    setPhase('summary')
  }, [taskId])

  const [starting, setStarting] = useState(false)
  const start = async () => {
    if (!task || starting) return
    setStarting(true)
    setErr(null)
    setMistakes([])
    setHelpSent(false)
    setConfirmEnd(false)
    setI(0)
    try {
      const r = await api.start(readName() || 'Worker', task.task_id)
      sidRef.current = r.session_id
      setSid(r.session_id)
      setStartedAt(Date.now())
      setChat([])
      quietNext.current = true // r.say = Moss tip (if any) + step 1
      setPhase('running')
      audio.current?.say(r.say, 'advance', { force: true })
    } catch (e) {
      setErr(`The camera check could not start: ${(e as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  // The edge keeps sessions in memory, so a restart (e.g. --reload while coding) forgets them.
  // Start a new session for the same worker and task, quietly, at the step the worker is on.
  const iRef = useRef(i)
  iRef.current = i
  const resuming = useRef(false)
  const onSessionLost = useCallback(async () => {
    if (!task || resuming.current) return
    resuming.current = true
    try {
      const r = await api.start(readName() || 'Worker', task.task_id)
      if (iRef.current > 0) await api.goto(r.session_id, iRef.current)
      sidRef.current = r.session_id
      setSid(r.session_id)
    } catch (e) {
      setErr(`Lost the coach and could not reconnect: ${(e as Error).message}`)
    } finally {
      resuming.current = false
    }
  }, [task])

  const onLiveStep = useCallback((p: StepPayload) => {
    quietNext.current = true
    setI(p.index)
  }, [])
  const onLiveFinished = useCallback(() => {
    quietNext.current = true
    finish(true)
  }, [finish])
  const onMistake = useCallback((m: LoggedMistake) => setMistakes((xs) => [...xs, m]), [])

  // SpacetimeDB just changed a support level (fading rules, or the job coach). Celebrate promotions out
  // loud; a step back to more help is never announced to the worker (dignity), the coach sees it.
  const onLevelChange = useCallback(
    (e: LevelChangeEvent) => {
      if (e.to <= e.from || !task) return
      const n = task.steps.findIndex((x) => x.id === e.stepId) + 1
      const label = `Step ${n}: ${levelOf(e.to).worker}`
      if (e.reason === 'promote') {
        const line = cfg?.phrases[`level_up_${e.to}`]?.text
        if (line) audio.current?.say([{ text: line, url: ttsUrl(line, voiceRef.current) }], 'answer', { force: true })
        setLevelUp({ text: `Level up! ${label}`, at: Date.now() })
      } else {
        setLevelUp({ text: `${e.by} moved ${label}`, at: Date.now() })
      }
    },
    [cfg, task],
  )
  useEffect(() => {
    if (!levelUp) return
    const t = window.setTimeout(() => setLevelUp(null), 7000)
    return () => window.clearTimeout(t)
  }, [levelUp])

  /** One utterance from the always-on mic → speech-to-text → answer (or a check, a hint, help). */
  const ask = useCallback(
    async (blob: Blob) => {
      const id = sidRef.current
      if (!id || thinkingRef.current) return
      thinkingRef.current = true
      setThinking(true)
      // a slow answer (Claude) gets "Let me look." first, so the worker knows they were heard
      const filler = window.setTimeout(() => cfg?.phrases.let_me_look && audio.current?.say([cfg.phrases.let_me_look], 'filler', { force: true }), 1800)
      try {
        let image = ''
        try {
          if (video.current) image = (await snapshot(grab(video.current), { x: 0, y: 0, w: 1, h: 1 }, 640)).jpeg
        } catch {
          /* answer without a photo */
        }
        const r: TalkResult = await api.talk(id, blob, image)
        if (!r.say.length) return // nothing said, our own voice, or not meant for the coach
        setChat((c) => [...c.slice(-2), { said: r.said, answer: r.answer }])
        const ck = r.check
        if (ck?.status === 'mistake' && !ck.repeat) onMistake({ stepIndex: ck.step_index ?? i, what: ck.reason || 'Something needs fixing.', fix: ck.fix || '', photo: ck.photo || null, at: Date.now() })
        if (ck?.finished || ck?.status === 'finished') {
          audio.current?.say(r.say, 'advance', { force: true })
          finish(true)
          return
        }
        if (ck?.next) {
          quietNext.current = true
          setI(ck.next.index)
        }
        if (r.help) setHelpSent(true)
        audio.current?.say(r.say, ck?.next ? 'advance' : 'answer', { force: true })
      } catch (e) {
        setErr(`I couldn't hear that: ${(e as Error).message}`)
      } finally {
        window.clearTimeout(filler)
        thinkingRef.current = false
        setThinking(false)
      }
    },
    [cfg, i, finish, onMistake],
  )
  const askRef = useRef(ask)
  useEffect(() => {
    askRef.current = ask
  }, [ask])

  // always-on mic while the task runs (paused while the coach talks or thinks)
  useEffect(() => {
    if (phase !== 'running' || !micOn) return
    const l = new Listener({ onUtterance: (b) => void askRef.current(b), isBlocked: () => !!audio.current?.busy || thinkingRef.current, onPhase: setListen })
    l.start().catch((e) => {
      setErr(`Microphone blocked: ${(e as Error).message}`)
      setMicOn(false)
    })
    return () => l.stop()
  }, [phase, micOn])

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
      playSay(r.say, 'answer')
      setHelpSent(true)
    } catch (e) {
      setErr(`Help could not be sent: ${(e as Error).message}`)
    }
  }

  // the wrist node (Uno Q on USB serial, edge/stepwise_edge/wrist.py): hold = the supervisor is called (CALL on the
  // matrix), short touch = a quiet note to the supervisor. The edge sends both; the page speaks the reply.
  useEdgeEvents((e) => {
    if (e.sid !== sidRef.current || phase !== 'running') return
    if (e.type === 'help_sent') setHelpSent(true)
    else if (e.type === 'wrist' && (e.action === 'call' || e.action === 'notify')) {
      if (e.action === 'call') setHelpSent(true)
      if (Array.isArray(e.say) && e.say.length) playSay(e.say as Say[], 'answer')
    }
  })

  if (!task) {
    return (
      <AppShell back={{ to: '/worker', label: 'My tasks' }}>
        {err ? <ErrorNote text="We could not open this task. Try again." onRetry={() => location.reload()} /> : <Loading lines={4} label="Loading the task" />}
      </AppShell>
    )
  }
  const coachName = task.voice?.name ?? 'Coach'
  const tl: TimelineStep[] = task.steps.map((s) => ({ id: s.id, instruction: s.instruction, photo: s.reference_photo }))

  return (
    <AppShell back={phase === 'running' ? undefined : { to: '/worker', label: 'My tasks' }}>
      <StdbGate quiet>
        {() =>
          workerId ? (
            <WorkerFading workerId={workerId} workerName={readName() || 'Worker'} taskId={task.task_id} onLevels={setLevels} onLevelChange={onLevelChange} />
          ) : null
        }
      </StdbGate>
      {levelUp && (
        <div className="levelup" role="status">
{levelUp.text}
        </div>
      )}
      {err && <p className="note-almost wk-note">{err}</p>}

      {phase === 'overview' && (
        <div className="wk stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 6 }}>
            <p className="eyebrow">{task.steps.length} steps</p>
            <h1 className="wk-display">{task.title}</h1>
            <p className="wk-lede">Look at the steps. Then press Start.</p>
          </div>
          <OverviewProgress task={task} levels={levels} coach={task.voice?.name} />
          <ol className="wk-steps" aria-label={`${task.steps.length} steps`}>
            {task.steps.map((s, k) => (
              <li key={s.id} className="wk-step card">
                <span className="wk-step-rail" aria-hidden>
                  <span className="wk-step-num num">{k + 1}</span>
                </span>
                <img src={apiUrl(s.reference_photo)} alt={s.done_right} />
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span className="wk-step-k">Step {k + 1}</span>
                    <SupportChip level={levels[s.id] ?? 0} />
                  </div>
                  <p className="wk-step-text">{s.instruction}</p>
                  <button className="btn btn-ghost wk-btn wk-hear" onClick={() => say(s.instruction)}>
                    Hear it
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button className="btn btn-primary btn-xl btn-block" onClick={start} disabled={!cfg || starting} aria-busy={starting}>
            {starting ? 'Starting…' : demoVideo ? 'Start task with the video' : 'Start task'}
          </button>
          <p className="wk-caption center">
            {demoVideo ? 'The video plays here and is checked like the camera. It stays in this browser.' : 'The camera turns on. Your face is blurred, and no video is saved.'}
          </p>
          <div className="video-pick wk-video-pick">
            <label className="btn btn-ghost wk-btn">
              {demoVideo ? 'Pick another video' : 'Use a video instead of the camera'}
              <input type="file" accept="video/*" hidden onChange={(e) => setDemoVideo(e.target.files?.[0] ?? null)} />
            </label>
            {demoVideo && (
              <>
                <span className="small">
                  Using <strong>{demoVideo.name}</strong>
                </span>
                <button className="btn btn-ghost wk-btn" onClick={() => setDemoVideo(null)}>
                  Use the camera
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {phase === 'running' && step && sid && cfg && (
        <div className="wk wk-run">
          <div className="wk-run-top">
            <StepTimeline steps={tl} current={i} orientation="horizontal" size="sm" />
            {confirmEnd ? (
              <div className="wk-confirm card" role="alertdialog" aria-label="Stop this task?">
                <span className="wk-title">Stop this task?</span>
                <button className="btn btn-primary wk-btn" onClick={() => finish(false)}>
                  Yes, stop
                </button>
                <button className="btn btn-outline wk-btn" onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost wk-btn wk-end" onClick={() => setConfirmEnd(true)}>
                End task
              </button>
            )}
          </div>
          <div className="wk-run-grid">
            <div className="wk-cam stack" style={{ gap: 12 }}>
              <LiveCheck cfg={cfg} sessionId={sid} onSay={playSay} onStep={onLiveStep} onFinished={onLiveFinished} onMistake={onMistake} videoRef={video} file={demoVideo} onSessionLost={onSessionLost} />
            </div>
            <aside className="wk-guide stack" style={{ gap: 16 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <p className="wk-mono wk-stepof">
                  STEP {i + 1} OF {task.steps.length}
                </p>
                <SupportChip level={levels[step.id] ?? 0} />
              </div>
              <div className="wk-meter" role="group" aria-label={`Step ${i + 1} of ${task.steps.length}`}>
                <div className="wk-meter-track" aria-hidden>
                  <span className="wk-meter-fill" style={{ width: `${(i / task.steps.length) * 100}%` }} />
                </div>
                <p className="wk-meter-text">
                  {cheer ? <span key={cheer.at} className="wk-cheer" role="status">Step {cheer.n} done. Nice work!</span> : i === 0 ? "Let's start. You can do this." : "You're doing great."}
                </p>
              </div>
              <p className="run-instruction">{step.instruction}</p>
              <figure className="ref-card card">
                <img src={apiUrl(step.reference_photo)} alt={step.done_right} />
                <figcaption>Done right looks like this.</figcaption>
              </figure>
              <div className="stack" style={{ gap: 8 }}>
                <button className={`mic-chip mic-${micOn ? (thinking ? 'thinking' : listen) : 'off'}`} onClick={() => setMicOn((m) => !m)} aria-pressed={micOn} aria-label={micOn ? 'Microphone on. Turn off' : 'Microphone off. Turn on'}>
                  <span className="mic-dot" aria-hidden />
                  {!micOn ? 'Mic off' : thinking ? 'Thinking…' : listen === 'hearing' ? 'Hearing you…' : listen === 'paused' ? `${coachName} is talking` : `Talk to ${task.voice?.name ?? 'your coach'}. Just ask.`}
                </button>
                <span className="wk-caption">Try: “Is this right?” · “What am I holding?” · “I'm stuck”</span>
              </div>
              {chat.length > 0 && (
                <ul className="wk-chat" aria-live="polite">
                  {chat.map((c, k) => (
                    <li key={k} className="stack" style={{ gap: 6 }}>
                      <span className="wk-you">You: “{c.said}”</span>
                      <CorrectionBubble name={coachName} text={c.answer} speaking={speaking && k === chat.length - 1} />
                    </li>
                  ))}
                </ul>
              )}
              <MistakeLog task={task} mistakes={mistakes} startedAt={startedAt} live />
            </aside>
          </div>
          <div className="wk-bar">
            <div className="wk-bar-nav">
              <button className="btn btn-outline wk-btn" onClick={() => say(step.instruction)}>
                Hear it
              </button>
              <button className="btn btn-outline wk-btn" onClick={() => go(-1)} disabled={i === 0}>
                ← Back
              </button>
              <button className="btn btn-primary wk-btn" onClick={() => go(1)}>
                {i === task.steps.length - 1 ? 'I finished' : 'Next →'}
              </button>
            </div>
            <button className={`btn wk-help ${helpSent ? 'sent' : 'btn-sol'}`} onClick={help} disabled={helpSent} aria-live="polite">
              {helpSent ? 'Help is coming.' : 'I need help'}
            </button>
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <div className="wk stack" style={{ gap: 22 }}>
          <Celebrate task={task} finished={finished} stoppedAt={i} mistakes={mistakes.length} progress={progress} levels={levels} coach={coachName} onHear={() => progress && audio.current?.say(progress.say, 'answer', { force: true })} />
          <StepTimeline steps={tl} current={finished ? task.steps.length : i} finished={finished} orientation="horizontal" size="sm" />
          <div className="wk-stats">
            <StatCard value={clock(endedAt - startedAt)} label="Time" />
            <StatCard value={`${finished ? task.steps.length : i} of ${task.steps.length}`} label="Steps done" />
            <StatCard value={mistakes.length} label={mistakes.length === 1 ? 'Thing we practiced' : 'Things we practiced'} />
          </div>
          <MistakeLog task={task} mistakes={mistakes} startedAt={startedAt} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-xl" onClick={start} disabled={starting} aria-busy={starting}>
              {starting ? 'Starting…' : 'Do it again'}
            </button>
            <Link className="btn btn-outline btn-xl" to="/worker">
              My tasks
            </Link>
          </div>
        </div>
      )}
      {phase !== 'overview' && <CaptionBar text={caption || ' '} speaking={speaking} />}
    </AppShell>
  )
}

/** Overview: how many steps the worker already does on their own. Levels come from SpacetimeDB. */
function OverviewProgress({ task, levels, coach }: { task: Task; levels: Record<number, number>; coach?: string }) {
  const total = task.steps.length
  const own = task.steps.filter((s) => (levels[s.id] ?? 0) >= 3).length
  const line =
    own === total ? 'You can do every step on your own. Amazing!' : own > 0 ? `You can do ${own} ${own === 1 ? 'step' : 'steps'} on your own. Great work!` : 'You are learning this task. Every try helps.'
  return (
    <section className="wk-prog card" aria-label="Your progress">
      <p className="eyebrow">Your progress</p>
      <p className="wk-prog-line">{line}</p>
      <div className="wk-prog-dots" aria-hidden>
        {task.steps.map((s) => (
          <span key={s.id} className={`wk-prog-dot ${(levels[s.id] ?? 0) >= 3 ? 'own' : ''}`} />
        ))}
      </div>
      <p className="wk-caption">
        <strong className="num">{own}</strong> on my own · <strong className="num">{total - own}</strong> still learning
      </p>
      {coach && <p className="wk-caption">{coach}'s voice will help you at each step.</p>}
    </section>
  )
}

/** Summary: a celebration. Never shame; a hard day is "good practice". */
function Celebrate({
  task,
  finished,
  stoppedAt,
  mistakes,
  progress,
  levels,
  coach,
  onHear,
}: {
  task: Task
  finished: boolean
  stoppedAt: number
  mistakes: number
  progress: Progress | null
  levels: Record<number, number>
  coach: string
  onHear: () => void
}) {
  const n = progress?.numbers
  const hard = !finished || mistakes >= task.steps.length
  const title = finished ? 'You did it!' : 'Good practice today.'
  const lede = finished ? (hard ? 'You did every step. Every try helps.' : 'You did every step. Great work!') : stoppedAt > 0 ? `You did ${stoppedAt} ${stoppedAt === 1 ? 'step' : 'steps'}. Every try helps.` : 'Every try helps. You can try again any time.'
  let compare = ''
  if (n?.last_time) {
    const d = n.by_self - n.last_time.by_self
    compare = d > 0 ? `${d} more than last time!` : d === 0 ? 'Same as last time. Nice and steady.' : 'Keep practicing. You are learning.'
  } else if (n) compare = 'This is your first time. Great start!'
  // next goal: the first step not yet "on my own"
  const nextIdx = task.steps.findIndex((s) => (levels[s.id] ?? 0) < 3)
  const goal = nextIdx >= 0 ? `Next time: try step ${nextIdx + 1} on your own.` : 'Next time: do it all on your own again.'
  return (
    <section className={`wk-celebrate card ${finished ? 'done' : ''}`} aria-live="polite">
      <h1 className="wk-display wk-celebrate-title">{title}</h1>
      <p className="wk-lede">{lede}</p>
      {n ? (
        <div className="wk-self">
          <span className="wk-self-n num">{n.by_self}</span>
          <span className="stack" style={{ gap: 4 }}>
            <span className="wk-title">{n.by_self === 1 ? 'step on your own' : 'steps on your own'}</span>
            {compare && <span className="wk-self-cmp">{compare}</span>}
          </span>
        </div>
      ) : (
        <p className="muted">Counting your steps…</p>
      )}
      {progress && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="progress-text">{progress.text}</p>
          <button className="btn btn-outline wk-btn wk-hear-again" onClick={onHear}>
            Hear {coach} say it again
          </button>
        </div>
      )}
      <p className="wk-goal">{goal}</p>
    </section>
  )
}

/** Every correction, in order: which step, what was seen, what to do instead. */
function MistakeLog({ task, mistakes, startedAt, live = false }: { task: Task; mistakes: LoggedMistake[]; startedAt: number; live?: boolean }) {
  return (
    <section className="mlog" aria-live={live ? 'polite' : undefined}>
      <h2 className="eyebrow wk-mlog-title">{live ? 'Things to fix' : 'Things we practiced'}</h2>
      {mistakes.length === 0 ? (
        <p className="muted small">{live ? 'Nothing yet. Keep going!' : 'Every step went well.'}</p>
      ) : (
        <ol className="mlog-list">
          {mistakes.map((m, k) => (
            <li key={k} className="mlog-item card">
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
