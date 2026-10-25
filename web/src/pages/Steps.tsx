import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Brand } from '../components/Layout'
import { LiveCheck } from '../components/LiveCheck'
import { CaptionBar, StepDots } from '../components/ui'
import { api, type PublicConfig, type StepPayload, type Task } from '../lib/api'
import { AudioQueue, apiUrl, type Say, type SpeechKind } from '../lib/audio'

const ttsUrl = (text: string, voice?: string | null) => `/tts?text=${encodeURIComponent(text)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}` // cached clip if pre-recorded

/** Worker view of a task: one big step at a time, with picture, voice and a "why". */
export function StepsPage() {
  const { taskId } = useParams()
  return <StepsView key={taskId ?? 'list'} taskId={taskId} />
}

function StepsView({ taskId }: { taskId?: string }) {
  const nav = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [tasks, setTasks] = useState<{ task_id: string; title: string; steps: number }[]>([])
  const [i, setI] = useState(0)
  const [done, setDone] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [showClip, setShowClip] = useState(false)
  const [caption, setCaption] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audio = useRef<AudioQueue | null>(null)
  const clip = useRef<HTMLVideoElement | null>(null)
  const started = useRef(false)
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [sid, setSid] = useState<string | null>(null)
  const [liveStarting, setLiveStarting] = useState(false)
  const sidRef = useRef<string | null>(null)
  const quietNext = useRef(false) // a live "done" already spoke "Great!" + the next step

  useEffect(() => {
    audio.current = new AudioQueue()
    audio.current.onCaption = (t, s) => {
      if (t) setCaption(t)
      setSpeaking(s)
    }
    api.config().then(setCfg).catch(() => {})
    return () => {
      audio.current?.stop()
      if (sidRef.current) void api.end(sidRef.current)
    }
  }, [])

  useEffect(() => {
    if (!taskId) {
      api.tasks().then(setTasks).catch((e) => setError(e.message))
      return
    }
    api
      .task(taskId)
      .then((t) => {
        setTask(t)
        if (t.source?.video_id) api.video(t.source.video_id).then((a) => setVideoUrl(a.video_url ? apiUrl(a.video_url) : null)).catch(() => {})
      })
      .catch((e) => setError(e.message))
  }, [taskId])

  const step = task?.steps[i]
  const say = useCallback((text: string) => audio.current?.play([{ text, url: ttsUrl(text, cfg?.voice_id) }]), [cfg?.voice_id])

  // speak each new step (after the first tap, so the browser allows audio)
  useEffect(() => {
    if (quietNext.current) {
      quietNext.current = false
      return
    }
    if (step && started.current && !done) say(step.instruction)
  }, [step, done, say])

  // ---- live camera check (Bitdeer) ----
  const startLive = async () => {
    if (!task) return
    started.current = true
    setLiveStarting(true)
    setError(null)
    try {
      const worker = localStorage.getItem('stepwise-worker') || 'Worker'
      const r = await api.start(worker, task.task_id)
      sidRef.current = r.session_id
      if (i > 0) await api.goto(r.session_id, i)
      setSid(r.session_id)
    } catch (e) {
      setError(`Live check could not start: ${(e as Error).message}`)
    } finally {
      setLiveStarting(false)
    }
  }
  const stopLive = () => {
    if (sidRef.current) void api.end(sidRef.current)
    sidRef.current = null
    setSid(null)
  }
  const playSay = useCallback((items: Say[], kind: SpeechKind) => audio.current?.say(items, kind), [])
  const onLiveStep = useCallback((p: StepPayload) => {
    quietNext.current = true
    setShowWhy(false)
    setShowClip(false)
    setI(p.index)
  }, [])
  const onLiveFinished = useCallback(() => {
    quietNext.current = true
    setDone(true)
  }, [])

  const go = useCallback(
    (d: number) => {
      if (!task) return
      started.current = true
      setShowWhy(false)
      setShowClip(false)
      if (i + d >= task.steps.length) {
        setDone(true)
        say('You did every step. Great work!')
        return
      }
      setDone(false)
      const next = Math.max(0, Math.min(task.steps.length - 1, i + d))
      setI(next)
      if (sidRef.current) void api.goto(sidRef.current, next).catch(() => {})
    },
    [task, i, say],
  )

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [go])

  // play only this step's part of the supervisor's video
  useEffect(() => {
    const v = clip.current
    if (!showClip || !v || !step || step.start_s === undefined) return
    const end = step.end_s ?? step.start_s + 5
    v.currentTime = step.start_s
    void v.play().catch(() => {})
    const stop = () => {
      if (v.currentTime >= end) v.pause()
    }
    v.addEventListener('timeupdate', stop)
    return () => v.removeEventListener('timeupdate', stop)
  }, [showClip, step])

  return (
    <div className="worker-shell">
      <header className="worker-header">
        <Brand />
        <Link to="/" className="btn btn-ghost">
          Exit
        </Link>
      </header>
      <main className="worker-main">
        {error && (
          <div className="consent-banner missing" role="alert">
            {error}
          </div>
        )}

        {!taskId && (
          <div className="stack" style={{ gap: 16 }}>
            <h1 style={{ fontSize: 40 }}>Pick your task</h1>
            {tasks.map((t) => (
              <button key={t.task_id} className="btn btn-secondary btn-xl btn-block" style={{ justifyContent: 'space-between' }} onClick={() => nav(`/steps/${t.task_id}`)}>
                <span>{t.title}</span>
                <span className="muted">{t.steps} steps →</span>
              </button>
            ))}
            {!tasks.length && <p className="muted">No tasks yet. Ask your supervisor to make one.</p>}
          </div>
        )}

        {task && step && !done && (
          <div className="stack" style={{ gap: 22 }}>
            <div className="spread">
              <span className="muted" style={{ fontWeight: 700, fontSize: 20 }}>
                {task.title}
              </span>
              <div className="row">
                <StepDots total={task.steps.length} current={i} />
                {sid ? (
                  <button className="btn btn-secondary" onClick={stopLive}>
                    ■ Stop camera
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={startLive} disabled={!cfg || liveStarting}>
                    📷 {liveStarting ? 'Starting…' : 'Live check'}
                  </button>
                )}
              </div>
            </div>
            <div className={`worker-step ${sid ? 'live' : ''}`}>
              <div className="stack" style={{ gap: 18 }}>
                <p className="instruction-text">{step.instruction}</p>
                <div className="row" style={{ gap: 12 }}>
                  <button
                    className="btn btn-primary btn-xl"
                    onClick={() => {
                      started.current = true
                      say(step.instruction)
                    }}
                  >
                    🔊 Hear it
                  </button>
                  <button
                    className="btn btn-secondary btn-xl"
                    aria-expanded={showWhy}
                    onClick={() => {
                      started.current = true
                      setShowWhy(true)
                      say(step.why)
                    }}
                  >
                    Why?
                  </button>
                  {videoUrl && step.start_s !== undefined && (
                    <button className="btn btn-secondary btn-xl" aria-pressed={showClip} onClick={() => setShowClip((v) => !v)}>
                      ▶ Show me
                    </button>
                  )}
                </div>
                {showWhy && (
                  <p className="why-line" role="status">
                    {step.why}
                  </p>
                )}
              </div>
              {sid && cfg ? (
                <div className="stack" style={{ gap: 10 }}>
                  <LiveCheck cfg={cfg} sessionId={sid} onSay={playSay} onStep={onLiveStep} onFinished={onLiveFinished} />
                  <figure className="picture-card small-card">
                    <img className="ref-photo" src={apiUrl(step.reference_photo)} alt={step.done_right} />
                    <figcaption>Done right looks like this</figcaption>
                  </figure>
                </div>
              ) : (
              <figure className="picture-card">
                {showClip && videoUrl ? (
                  <video ref={clip} className="ref-photo" src={videoUrl} muted playsInline aria-label={`Video of step ${i + 1}`} />
                ) : (
                  <img className="ref-photo" src={apiUrl(step.reference_photo)} alt={step.done_right} />
                )}
                <figcaption>{showClip ? 'Watch how it is done' : 'Done right looks like this'}</figcaption>
              </figure>
              )}
            </div>
            <div className="worker-nav">
              <button className="btn btn-secondary btn-xl" onClick={() => go(-1)} disabled={i === 0}>
                ← Back
              </button>
              <button className="btn btn-primary btn-xl" onClick={() => go(1)}>
                {i === task.steps.length - 1 ? 'I finished ✓' : 'Next step →'}
              </button>
            </div>
          </div>
        )}

        {task && done && (
          <div className="stack" style={{ gap: 24, alignItems: 'center', textAlign: 'center', paddingTop: 40 }}>
            <p className="instruction-text">You did every step. Great work!</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button
                className="btn btn-primary btn-xl"
                onClick={() => {
                  setDone(false)
                  setI(0)
                  if (sidRef.current) void api.goto(sidRef.current, 0).catch(() => {}) // reset the live session too
                }}
              >
                Start again
              </button>
              <Link className="btn btn-secondary btn-xl" to="/steps">
                Other tasks
              </Link>
            </div>
          </div>
        )}
      </main>
      {task && <CaptionBar text={caption || ' '} speaking={speaking} />}
    </div>
  )
}
