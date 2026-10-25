import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CameraStage, type FrameInfo } from '../components/CameraStage'
import { CaptionBar, Panel, StepDots, TierBadge, VerdictPill } from '../components/ui'
import { asTier } from '../format'
import { api, type CheckResult, type PublicConfig, type StepPayload, type TalkResult } from '../lib/api'
import { AudioQueue, apiUrl, type Say } from '../lib/audio'
import { TriggerEngine, type TriggerState } from '../lib/triggers'
import { grab, snapshot, type FrameRing } from '../lib/vision'
import { getMedia } from '../lib/media'

const PHASE_WORD = { no_hands: 'No hands', moving: 'Hands moving', still: 'Hands still', busy: 'Checking…' } as const
const HOLD_FOR_HELP_MS = 1000
const TALK_MAX_MS = 6000

export function CoachPage() {
  const [params] = useSearchParams()
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [tasks, setTasks] = useState<{ task_id: string; title: string; steps: number }[]>([])
  const [taskId, setTaskId] = useState(params.get('task') ?? '')
  const [worker, setWorker] = useState(() => localStorage.getItem('stepwise-worker') ?? 'Jordan')
  const [sid, setSid] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [step, setStep] = useState<StepPayload | null>(null)
  const [finished, setFinished] = useState(false)
  const [last, setLast] = useState<CheckResult | null>(null)
  const [lastTalk, setLastTalk] = useState<TalkResult | null>(null)
  const [trig, setTrig] = useState<TriggerState | null>(null)
  const [caption, setCaption] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [helpSent, setHelpSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const [recheck, setRecheck] = useState(0) // bumps → a second look ~1 s after a first "done"
  const [lastSnap, setLastSnap] = useState<{ jpeg: string; step_id: number } | null>(null)
  const [labeled, setLabeled] = useState<string | null>(null)
  const taskRef = useRef('')

  const ring = useRef<FrameRing | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const engine = useRef<TriggerEngine | null>(null)
  const audio = useRef<AudioQueue | null>(null)
  const sidRef = useRef<string | null>(null)
  const stepIdRef = useRef(0)
  const busyRef = useRef(false)
  const rec = useRef<MediaRecorder | null>(null)
  const recTimer = useRef<number | undefined>(undefined)
  const mic = useRef<MediaStream | null>(null)

  useEffect(() => {
    audio.current = new AudioQueue()
    audio.current.onCaption = (t, s) => {
      if (t) setCaption(t)
      setSpeaking(s)
    }
    api.config().then(setCfg).catch((e) => setError(`Edge app not reachable: ${e.message}`))
    api.tasks().then((t) => {
      setTasks(t)
      setTaskId((cur) => cur || t[0]?.task_id || '')
    })
    return () => {
      audio.current?.stop()
      if (sidRef.current) void api.end(sidRef.current)
      mic.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const speak = (items: Say[]) => audio.current?.play(items)
  const area = () => JSON.parse(localStorage.getItem('stepwise-work-area') ?? 'null')

  /** Privacy-safe current photo: sharpest recent frame, faces blurred, cropped to the work area. */
  const photo = useCallback(async (): Promise<string | null> => {
    if (!cfg) return null
    const now = performance.now() / 1000
    const f = ring.current?.sharpest(now, 1.0)
    const src = f?.canvas ?? (video.current ? grab(video.current) : null)
    if (!src) return null
    return (await snapshot(src, area(), cfg.coach.snapshot_px)).jpeg
  }, [cfg])

  useEffect(() => {
    if (step) stepIdRef.current = step.step.id
  }, [step])

  const saveLabel = async (label: string) => {
    if (!lastSnap) return
    try {
      const r = await api.label(lastSnap.jpeg, taskRef.current, lastSnap.step_id, label)
      setLabeled(`Saved as “${label.replace('_', ' ')}” · ${r.count} in test set`)
    } catch (e) {
      setLabeled(`Not saved: ${(e as Error).message}`)
    }
  }

  const applyCheck = useCallback((r: CheckResult) => {
    setLast(r)
    if (r.status === 'confirming') setRecheck((n) => n + 1)
    if (r.say?.length) speak(r.say)
    if (r.finished) setFinished(true)
    if (r.next) setStep(r.next)
  }, [])

  /** One snapshot → Bitdeer (→ Claude when unclear). Triggers are ignored until the answer is back. */
  const runCheck = useCallback(
    async (trigger: string) => {
      const s = sidRef.current
      if (!s || busyRef.current || !cfg) return
      busyRef.current = true
      if (engine.current) engine.current.busy = true
      setFlash((n) => n + 1)
      let filler: number | undefined
      if (trigger === 'voice' || trigger === 'button') filler = window.setTimeout(() => speak([cfg.phrases.let_me_look]), 1000)
      try {
        const img = await photo()
        if (!img) throw new Error('no camera frame')
        setLastSnap({ jpeg: img, step_id: stepIdRef.current })
        setLabeled(null)
        applyCheck(await api.check(s, img, trigger))
      } catch (e) {
        setError(`Check failed: ${(e as Error).message}. Say "done" or press Next to keep going.`)
      } finally {
        window.clearTimeout(filler)
        busyRef.current = false
        if (engine.current) {
          engine.current.busy = false
          engine.current.markChecked(performance.now() / 1000)
        }
      }
    },
    [cfg, photo, applyCheck],
  )

  useEffect(() => {
    if (!recheck) return
    const t = window.setTimeout(() => void runCheck('confirm'), 1200)
    return () => window.clearTimeout(t)
  }, [recheck, runCheck])

  const onFrame = useCallback(
    ({ hands, t, area: a }: FrameInfo) => {
      const e = engine.current
      if (!e || !sidRef.current || finished) return
      const s = e.update(hands, t, a)
      setTrig(s)
      if (s.trigger && !listening) void runCheck(s.trigger)
    },
    [runCheck, finished, listening],
  )

  const start = async () => {
    if (!cfg || !taskId) return
    setError(null)
    localStorage.setItem('stepwise-worker', worker)
    try {
      const r = await api.start(worker, taskId)
      sidRef.current = r.session_id
      taskRef.current = r.task.task_id
      setSid(r.session_id)
      setTitle(r.task.title)
      setStep(r)
      setFinished(false)
      setHelpSent(false)
      setLast(null)
      engine.current = new TriggerEngine(cfg.coach, performance.now() / 1000)
      speak(r.say)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const end = async () => {
    if (sidRef.current) await api.end(sidRef.current)
    sidRef.current = null
    setSid(null)
    setStep(null)
    audio.current?.stop()
  }

  const next = async () => {
    if (!sidRef.current) return
    try {
      applyCheck(await api.next(sidRef.current))
      engine.current?.markChecked(performance.now() / 1000)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const help = async () => {
    if (!sidRef.current) return
    setHelpSent(true)
    try {
      const r = await api.help(sidRef.current, await photo())
      speak(r.say)
    } catch (e) {
      setError(`Help could not be sent: ${(e as Error).message}`)
    }
  }

  // ---- push-to-talk ----
  const stopTalk = useCallback(() => {
    window.clearTimeout(recTimer.current)
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const startTalk = useCallback(async () => {
    if (!sidRef.current || rec.current?.state === 'recording') return
    try {
      mic.current ??= await getMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setError('Microphone blocked. Allow the mic for this site to use Talk. The Help button always works.')
      return
    }
    audio.current?.stop() // barge-in: stop talking and listen
    const chunks: Blob[] = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4'
    const r = new MediaRecorder(mic.current, { mimeType: mime })
    rec.current = r
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = async () => {
      setListening(false)
      const blob = new Blob(chunks, { type: mime.split(';')[0] })
      console.info(`talk: recorded ${blob.size} bytes (${mime})`)
      if (!sidRef.current || !cfg) return
      if (blob.size < 2000) {
        setCaption("I didn't hear you. Press Talk and try again.")
        return
      }
      const filler = window.setTimeout(() => speak([cfg.phrases.let_me_look]), 1000)
      busyRef.current = true
      if (engine.current) engine.current.busy = true
      try {
        const res = await api.talk(sidRef.current, blob, (await photo()) ?? '')
        window.clearTimeout(filler)
        setLastTalk(res)
        if (!res.said) setCaption("I didn't hear you. Press Talk and try again.")
        if (res.check) applyCheck(res.check)
        else if (res.say?.length) speak(res.say)
        if (res.help) setHelpSent(true)
      } catch (e) {
        window.clearTimeout(filler)
        setError(`Talk failed: ${(e as Error).message}`)
      } finally {
        busyRef.current = false
        if (engine.current) {
          engine.current.busy = false
          engine.current.markChecked(performance.now() / 1000)
        }
      }
    }
    r.start()
    setListening(true)
    setCaption('Listening…')
    recTimer.current = window.setTimeout(stopTalk, TALK_MAX_MS)
  }, [cfg, photo, applyCheck, stopTalk])

  const toggleTalk = useCallback(() => {
    if (rec.current?.state === 'recording') stopTalk()
    else void startTalk()
  }, [startTalk, stopTalk])

  // Spacebar = the temple button: tap = talk, hold 1 s = help
  useEffect(() => {
    let downAt = 0
    let holdTimer: number | undefined
    let helped = false
    const isField = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest('input,textarea,select')
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isField(e) || !sidRef.current) return
      e.preventDefault()
      downAt = performance.now()
      helped = false
      holdTimer = window.setTimeout(() => {
        helped = true
        void help()
      }, HOLD_FOR_HELP_MS)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isField(e) || !downAt) return
      e.preventDefault()
      window.clearTimeout(holdTimer)
      if (!helped && performance.now() - downAt < HOLD_FOR_HELP_MS) toggleTalk()
      downAt = 0
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  })

  // ---------- setup screen ----------
  if (!sid || !step) {
    return (
      <div className="stack" style={{ gap: 20, maxWidth: 760 }}>
        <div className="page-head">
          <h1>Coach</h1>
          <p className="muted">The worker wears the glasses. The camera watches the hands; a photo is checked only when it matters.</p>
        </div>
        {error && (
          <div className="consent-banner missing" role="alert">
            {error}
          </div>
        )}
        <Panel title="Start a session">
          <div className="stack">
            <div className="field">
              <label htmlFor="worker">Worker</label>
              <input id="worker" className="search" value={worker} onChange={(e) => setWorker(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="task">Task</label>
              {tasks.length ? (
                <select id="task" className="search" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  {tasks.map((t) => (
                    <option key={t.task_id} value={t.task_id}>
                      {t.title} ({t.steps} steps)
                    </option>
                  ))}
                </select>
              ) : (
                <p className="muted">No tasks yet. Teach one first.</p>
              )}
            </div>
            <button className="btn btn-xl btn-primary" onClick={start} disabled={!cfg || !taskId || !worker.trim()}>
              Start coaching
            </button>
            <p className="small muted">Button: Spacebar tap = talk, hold 1 second = help. The Help button on screen always works.</p>
          </div>
        </Panel>
      </div>
    )
  }

  // ---------- coaching screen ----------
  const memory = step.memory.find((m) => m.kind === 'mistake')
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontWeight: 700 }}>
            {worker} · {title}
          </span>
          <StepDots total={step.total} current={finished ? step.total - 1 : step.index} />
        </div>
        <button className="btn btn-ghost" onClick={end}>
          End session
        </button>
      </div>

      {error && (
        <div className="consent-banner missing" role="alert">
          <span>{error}</span>
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="coach-top">
        <div className="stack" style={{ gap: 14 }}>
          {finished ? (
            <p className="instruction-text">You did every step. Great work!</p>
          ) : (
            <p className="instruction-text">{step.step.instruction}</p>
          )}
          {!finished && memory && (
            <div className="memory-banner" role="status">
              <span>🧠 {step.say.length > 1 ? step.say[0].text : `Remember: ${memory.tip}`}</span>
              <TierBadge tier="moss" latency_ms={step.memory_ms} />
            </div>
          )}
          {!finished && last?.status === 'mistake' && (
            <p className="almost-line" role="status">
              {step.step.correction}
            </p>
          )}
          {helpSent && (
            <div className="consent-banner" role="status">
              <strong>Help is coming.</strong> Your supervisor got the alert with a photo.
            </div>
          )}
        </div>
        <figure className="picture-card">
          {step.step.reference_photo ? <img className="ref-photo" src={apiUrl(step.step.reference_photo)} alt="Reference photo: the step done right" /> : <div className="ref-photo" />}
          <figcaption>Done right looks like this</figcaption>
        </figure>
      </div>

      <div className="coach-bottom">
        <CameraStage
          ringRef={ring}
          videoRef={video}
          onFrame={onFrame}
          overlay={
            <>
              {flash > 0 && <div key={flash} className="flash" />}
              <div className="cam-badge">
                {trig && (
                  <span className="cam-chip">
                    <span className={`dot ${trig.phase === 'still' ? 'dot-ok' : trig.phase === 'busy' ? 'dot-degraded' : 'dot-off'}`} aria-hidden />
                    {PHASE_WORD[trig.phase]}
                  </span>
                )}
                {listening && <span className="cam-chip">🎙 Listening…</span>}
              </div>
            </>
          }
        />
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Last check">
            {last ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row">
                  <VerdictPill status={last.status} />
                  <TierBadge tier={asTier(last.source)} latency_ms={last.latency_ms} />
                  {last.escalated && <span className="small muted">asked Claude</span>}
                </div>
                <span className="small muted">
                  {last.reason} · trigger: {last.trigger.replace('_', ' ')}
                </span>
              </div>
            ) : (
              <span className="muted small">Waiting for the hands to pause…</span>
            )}
            {lastTalk && (
              <div className="small" style={{ marginTop: 10 }}>
                <span className="muted">Heard:</span> “{lastTalk.said}” → <TierBadge tier={asTier(lastTalk.answered_by)} latency_ms={lastTalk.latency_ms} />
              </div>
            )}
          </Panel>
          <div className="big-buttons">
            <button className={`btn btn-secondary ${listening ? 'rec' : ''}`} aria-pressed={listening} onClick={toggleTalk} disabled={finished}>
              🎙 {listening ? 'Stop' : 'Talk'}
            </button>
            <button className="btn btn-urgent" onClick={help}>
              ✋ Help
            </button>
          </div>
          {lastSnap && (
            <Panel title="Test set">
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <img src={lastSnap.jpeg} alt="Last snapshot sent to the model" style={{ width: 120, borderRadius: 8 }} />
                <div className="stack" style={{ gap: 6 }}>
                  <span className="small muted">What really happened in the last snapshot?</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost" onClick={() => saveLabel('done')}>Done</button>
                    <button className="btn btn-ghost" onClick={() => saveLabel('mistake')}>Almost</button>
                    <button className="btn btn-ghost" onClick={() => saveLabel('in_progress')}>Working</button>
                  </div>
                  {labeled && <span className="small" role="status">{labeled}</span>}
                </div>
              </div>
            </Panel>
          )}
          <div className="row">
            <button className="btn btn-secondary" onClick={() => runCheck('button')} disabled={finished}>
              ✓ Done – check now
            </button>
            <button className="btn btn-ghost" onClick={next} disabled={finished}>
              Next step →
            </button>
          </div>
        </div>
      </div>

      <CaptionBar text={listening ? 'Listening…' : caption || ' '} speaking={speaking} />
    </div>
  )
}
