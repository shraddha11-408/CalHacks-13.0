import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CameraStage, type FrameInfo } from '../components/CameraStage'
import { Panel } from '../components/ui'
import { fmtLatency } from '../format'
import { api, type PublicConfig, type Step, type Task } from '../lib/api'
import { apiUrl } from '../lib/audio'
import { TriggerEngine } from '../lib/triggers'
import { snapshot, type FrameRing } from '../lib/vision'

type Phase = 'idle' | 'recording' | 'writing' | 'review' | 'saving' | 'saved'
interface Keyframe {
  jpeg: string
  t: number
  trigger: string
}

const FIELDS: { key: keyof Step; label: string; rows?: number }[] = [
  { key: 'instruction', label: 'Instruction (what the voice says)', rows: 2 },
  { key: 'done_right', label: 'Done right looks like (what the camera checks)', rows: 2 },
  { key: 'common_mistake', label: 'Common mistake' },
  { key: 'correction', label: 'Correction (said when the mistake is seen)' },
  { key: 'why', label: 'Why (answer to “Why?”)' },
]

export function TeachPage() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [title, setTitle] = useState('Fold a towel the hotel way')
  const [phase, setPhase] = useState<Phase>('idle')
  const [frames, setFrames] = useState<Keyframe[]>([])
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const [existing, setExisting] = useState<{ task_id: string; title: string; steps: number }[]>([])
  const ring = useRef<FrameRing | null>(null)
  const engine = useRef<TriggerEngine | null>(null)
  const phaseRef = useRef(phase)
  const framesRef = useRef<Keyframe[]>([])
  const lastKf = useRef(0)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    api.config().then(setCfg).catch((e) => setError(`Edge app not reachable: ${e.message}`))
    api.tasks().then(setExisting).catch(() => {})
  }, [])

  const capture = async (trigger: string, t: number) => {
    if (!cfg || !ring.current) return
    if (framesRef.current.length >= cfg.coach.keyframes_max) return
    if (trigger !== 'final' && t - lastKf.current < cfg.coach.keyframe_min_gap_s) return
    const f = ring.current.sharpest(t, 1.0)
    if (!f) return
    lastKf.current = t
    const area = JSON.parse(localStorage.getItem('stepwise-work-area') ?? 'null')
    const { jpeg } = await snapshot(f.canvas, area, cfg.coach.snapshot_px)
    framesRef.current = [...framesRef.current, { jpeg, t, trigger }]
    setFrames(framesRef.current)
    setFlash((n) => n + 1)
  }

  const onFrame = ({ hands, t, area }: FrameInfo) => {
    if (phaseRef.current !== 'recording' || !engine.current) return
    const s = engine.current.update(hands, t, area)
    if (s.trigger) void capture(s.trigger, t)
  }

  const start = () => {
    if (!cfg) return
    setError(null)
    setTask(null)
    framesRef.current = []
    setFrames([])
    lastKf.current = 0
    // teach: pause + hands-leave trigger key frames; a 5 s timeout catches steps without a clear pause
    engine.current = new TriggerEngine({ ...cfg.coach, timeout_s: 5 }, performance.now() / 1000)
    setPhase('recording')
  }

  const stop = async () => {
    await capture('final', performance.now() / 1000)
    const kf = framesRef.current
    if (!kf.length) {
      setPhase('idle')
      setError('No key frames yet. Keep your hands in the work area and pause between steps.')
      return
    }
    setPhase('writing')
    try {
      const t = await api.teach(title, kf.map((k) => k.jpeg))
      setTask(t)
      setInfo(`Claude wrote ${t.steps.length} steps from ${kf.length} key frames in ${fmtLatency(t.latency_ms)}.`)
      setPhase('review')
    } catch (e) {
      setError(String((e as Error).message))
      setPhase('idle')
    }
  }

  const loadExisting = async (id: string) => {
    if (!id) return
    try {
      const t = await api.task(id)
      setTask(t)
      setTitle(t.title)
      setFrames([])
      setInfo(null)
      setPhase('review')
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const update = (i: number, patch: Partial<Step>) => setTask((t) => (t ? { ...t, steps: t.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : t))
  const move = (i: number, d: number) =>
    setTask((t) => {
      if (!t) return t
      const s = [...t.steps]
      const j = i + d
      if (j < 0 || j >= s.length) return t
      ;[s[i], s[j]] = [s[j], s[i]]
      return { ...t, steps: s }
    })
  const remove = (i: number) => setTask((t) => (t ? { ...t, steps: t.steps.filter((_, k) => k !== i) } : t))
  const add = () =>
    setTask((t) =>
      t ? { ...t, steps: [...t.steps, { id: t.steps.length + 1, instruction: '', done_right: '', common_mistake: '', correction: 'Almost. ', why: '', reference_photo: t.frames?.[0] ?? '' }] } : t,
    )

  const save = async () => {
    if (!task) return
    setPhase('saving')
    setError(null)
    try {
      const r = await api.saveTask(task.task_id, title, task.steps)
      setTask(r)
      setInfo(r.audio_ok ? `Saved. Every instruction, correction and reason is pre-recorded (${fmtLatency(r.audio_ms)}).` : `Saved, but pre-recording failed: ${r.audio_error}. Voice will be generated on the fly.`)
      setPhase('saved')
    } catch (e) {
      setError(String((e as Error).message))
      setPhase('review')
    }
  }

  const recording = phase === 'recording'
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Teach a task</h1>
          <p className="muted">Wear the glasses and do the task once. Pause your hands for a moment after each step.</p>
        </div>
        <div className="row">
          {existing.length > 0 && phase !== 'recording' && (
            <select className="search" style={{ width: 'auto' }} defaultValue="" onChange={(e) => loadExisting(e.target.value)} aria-label="Edit a saved task">
              <option value="">Edit a saved task…</option>
              {existing.map((t) => (
                <option key={t.task_id} value={t.task_id}>
                  {t.title} ({t.steps} steps)
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="consent-banner missing" role="alert">
          {error}
        </div>
      )}

      <div className="coach-top">
        <Panel title="Camera">
          <CameraStage
            ringRef={ring}
            onFrame={onFrame}
            overlay={
              <>
                {flash > 0 && <div key={flash} className="flash" />}
                <div className="cam-badge">
                  {recording && (
                    <span className="cam-chip">
                      <span className="rec-dot" aria-hidden /> Teaching · {frames.length} key frames
                    </span>
                  )}
                </div>
              </>
            }
          />
        </Panel>
        <Panel title="Task">
          <div className="stack">
            <div className="field">
              <label htmlFor="title">Task name</label>
              <input id="title" className="search" value={title} onChange={(e) => setTitle(e.target.value)} disabled={recording} />
            </div>
            {recording ? (
              <button className="btn btn-xl btn-urgent btn-block" onClick={stop}>
                <span className="rec-dot" aria-hidden /> Stop teaching
              </button>
            ) : (
              <button className="btn btn-xl btn-primary btn-block" onClick={start} disabled={!cfg || phase === 'writing' || phase === 'saving'}>
                {phase === 'writing' ? 'Claude is writing the steps…' : 'Start teaching'}
              </button>
            )}
            <p className="small muted">
              Key frames are taken when your hands pause (about {cfg?.coach.pause_s ?? 0.8} s) or leave the work area. Up to {cfg?.coach.keyframes_max ?? 20}. No video is recorded; faces are blurred.
            </p>
            {info && (
              <p className="small" role="status" style={{ color: 'var(--success)' }}>
                {info}
              </p>
            )}
            {phase === 'saved' && task && (
              <Link className="btn btn-primary" to={`/coach?task=${task.task_id}`}>
                Coach a worker with this task →
              </Link>
            )}
          </div>
        </Panel>
      </div>

      {frames.length > 0 && (
        <Panel title={`Key frames (${frames.length})`}>
          <div className="thumbs">
            {frames.map((f, i) => (
              <figure key={i} className="thumb">
                <img src={f.jpeg} alt={`Key frame ${i}`} />
                <figcaption>
                  #{i} · {f.trigger.replace('_', ' ')}
                </figcaption>
              </figure>
            ))}
          </div>
        </Panel>
      )}

      {task && (phase === 'review' || phase === 'saving' || phase === 'saved') && (
        <Panel
          title={`Steps · ${task.steps.length}`}
          actions={
            <>
              <button className="btn btn-secondary" onClick={add}>
                + Add step
              </button>
              <button className="btn btn-primary" onClick={save} disabled={phase === 'saving'}>
                {phase === 'saving' ? 'Saving + recording voice…' : 'Save task'}
              </button>
            </>
          }
        >
          <div className="stack">
            {task.steps.map((s, i) => (
              <article key={i} className="panel step-edit">
                <div className="stack" style={{ gap: 6 }}>
                  {s.reference_photo ? <img src={apiUrl(s.reference_photo)} alt={`Reference photo for step ${i + 1}`} /> : <div className="ref-photo" />}
                  {task.frames && task.frames.length > 1 && (
                    <select
                      className="search small"
                      style={{ minHeight: 36, padding: '2px 6px' }}
                      value={s.reference_photo}
                      onChange={(e) => update(i, { reference_photo: e.target.value })}
                      aria-label={`Reference photo for step ${i + 1}`}
                    >
                      {task.frames.map((f, k) => (
                        <option key={f} value={f}>
                          Frame #{k}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="spread">
                    <span className="row">
                      <span className="step-num">{i + 1}</span>
                      <strong>Step {i + 1}</strong>
                    </span>
                    <span className="row" style={{ gap: 2 }}>
                      <button className="btn btn-ghost" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
                        ↑
                      </button>
                      <button className="btn btn-ghost" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === task.steps.length - 1}>
                        ↓
                      </button>
                      <button className="btn btn-ghost" onClick={() => remove(i)} aria-label="Delete step">
                        ✕
                      </button>
                    </span>
                  </div>
                  {FIELDS.map((f) => (
                    <div key={f.key} className="field">
                      <label htmlFor={`${f.key}-${i}`}>{f.label}</label>
                      {f.rows ? (
                        <textarea id={`${f.key}-${i}`} className="search" rows={f.rows} style={{ minHeight: 60 }} value={String(s[f.key] ?? '')} onChange={(e) => update(i, { [f.key]: e.target.value })} />
                      ) : (
                        <input id={`${f.key}-${i}`} className="search" value={String(s[f.key] ?? '')} onChange={(e) => update(i, { [f.key]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
