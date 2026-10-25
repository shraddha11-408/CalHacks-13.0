import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LiveCheck, type LoggedMistake } from '../components/LiveCheck'
import { StdbGate } from '../components/Stdb'
import { WorkerFading, type LevelChangeEvent } from '../components/WorkerFading'
import { levelOf } from '../lib/levels'
import { CaptionBar, StepDots } from '../components/ui'
import { api, type Progress, type PublicConfig, type StepPayload, type TalkResult, type Task } from '../lib/api'
import { AudioQueue, apiUrl, type Say, type SpeechKind } from '../lib/audio'
import { Listener, type ListenPhase } from '../lib/listen'
import { grab, snapshot } from '../lib/vision'

const NAME_KEY = 'stepwise-worker'
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
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

// Not taught yet: shown in the list so workers see what's coming, but they can't be started.
const PLACEHOLDER_TASKS = ['Restock new produce', 'Manage shift timings']

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
            <div className="task-list">
              {tasks?.map((t) => (
                <Link key={t.task_id} to={`/worker/${t.task_id}`} className="task-row">
                  <span className="task-row-title">{t.title}</span>
                  <span className="muted">{t.steps} steps →</span>
                </Link>
              ))}
              {tasks &&
                PLACEHOLDER_TASKS.map((title) => (
                  <div key={title} className="task-row soon" aria-disabled="true">
                    <span className="task-row-title">{title}</span>
                    <span className="muted">Coming soon</span>
                  </div>
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
      setChat([])
      quietNext.current = true // r.say = Moss tip (if any) + step 1
      setPhase('running')
      audio.current?.say(r.say, 'advance', { force: true })
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

  if (!task) {
    return (
      <AppShell back={{ to: '/worker', label: 'My tasks' }}>
        <p className="muted">{err ?? 'Loading…'}</p>
      </AppShell>
    )
  }

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
          <span aria-hidden>★</span> {levelUp.text}
        </div>
      )}
      {err && <p className="note-almost">{err}</p>}

      {phase === 'overview' && (
        <div className="stack" style={{ gap: 22 }}>
          <div>
            <h1 className="app-title">{task.title}</h1>
            <p className="muted">{task.steps.length} steps. Look at them, then press Start.</p>
            {task.voice && <p className="small muted">🔊 You will hear {task.voice.name}'s voice.</p>}
          </div>
          <ol className="step-list">
            {task.steps.map((s, k) => (
              <li key={s.id} className="step-item">
                <img src={apiUrl(s.reference_photo)} alt={s.done_right} />
                <div className="stack" style={{ gap: 4 }}>
                  <span className="step-n">
                    Step {k + 1} <LevelBadge level={levels[s.id] ?? 0} />
                  </span>
                  <p className="step-text">{s.instruction}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => say(s.instruction)}>
                    🔊 Hear it
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="video-pick">
            <label className="btn btn-secondary">
              📹 {demoVideo ? 'Pick another video' : 'Use a video instead of the camera'}
              <input type="file" accept="video/*" hidden onChange={(e) => setDemoVideo(e.target.files?.[0] ?? null)} />
            </label>
            {demoVideo && (
              <>
                <span className="small">
                  Using <strong>{demoVideo.name}</strong>
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setDemoVideo(null)}>
                  Use the camera
                </button>
              </>
            )}
          </div>
          <button className="btn btn-primary btn-xl btn-block" onClick={start} disabled={!cfg}>
            {demoVideo ? '▶ Start task with the video' : '📷 Start task'}
          </button>
          <p className="small muted center">
            {demoVideo ? 'The video plays here and is checked like the camera. It stays in this browser.' : 'The camera turns on. Your face is blurred, and no video is saved.'}
          </p>
        </div>
      )}

      {phase === 'running' && step && sid && cfg && (
        <div className="run">
          <div className="run-main stack" style={{ gap: 14 }}>
            <div className="spread">
              <span className="step-n">
                Step {i + 1} of {task.steps.length} <LevelBadge level={levels[step.id] ?? 0} />
              </span>
              <StepDots total={task.steps.length} current={i} />
            </div>
            <p className="run-instruction">{step.instruction}</p>
            <div className="row" style={{ gap: 8 }}>
              <button className={`mic-chip mic-${micOn ? (thinking ? 'thinking' : listen) : 'off'}`} onClick={() => setMicOn((m) => !m)} aria-pressed={micOn} aria-label={micOn ? 'Microphone on. Turn off' : 'Microphone off. Turn on'}>
                <span className="mic-dot" aria-hidden />
                {!micOn ? 'Mic off' : thinking ? 'Thinking…' : listen === 'hearing' ? 'Hearing you…' : listen === 'paused' ? `${task.voice?.name ?? 'Coach'} is talking` : `Talk to ${task.voice?.name ?? 'your coach'} — just ask`}
              </button>
              <span className="small muted">Try: “What am I holding?” · “Is this right?” · “I'm stuck” · “Help”</span>
            </div>
            {chat.length > 0 && (
              <ul className="chat" aria-live="polite">
                {chat.map((c, k) => (
                  <li key={k}>
                    <span className="chat-you">You: “{c.said}”</span>
                    <span className="chat-coach">{c.answer}</span>
                  </li>
                ))}
              </ul>
            )}
            <LiveCheck cfg={cfg} sessionId={sid} onSay={playSay} onStep={onLiveStep} onFinished={onLiveFinished} onMistake={onMistake} videoRef={video} file={demoVideo} />
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
          <section className="progress-card" aria-live="polite">
            <span className="step-n">Your progress</span>
            {progress ? (
              <>
                <p className="progress-text">{progress.text}</p>
                <div className="row">
                  <button className="btn btn-secondary btn-sm" onClick={() => audio.current?.say(progress.say, 'answer', { force: true })}>
                    🔊 Hear it again
                  </button>
                  {progress.numbers.last_time && (
                    <span className="small muted">
                      Last time: {progress.numbers.last_time.by_self} steps by yourself, {progress.numbers.last_time.corrections} reminders
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Counting your steps…</p>
            )}
          </section>
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

/** Support level of a step, from SpacetimeDB: four pips, filled as the worker needs less help. */
function LevelBadge({ level }: { level: number }) {
  return (
    <span className={`lvl lvl-${level}`} title={levelOf(level).says}>
      <span className="pips" aria-hidden>
        {[0, 1, 2, 3].map((p) => (
          <i key={p} className={p <= level ? 'on' : ''} />
        ))}
      </span>
      {levelOf(level).worker}
    </span>
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
