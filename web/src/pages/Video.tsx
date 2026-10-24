import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Panel, TierBadge } from '../components/ui'
import { fmtLatency } from '../format'
import { api, type Task, type VideoAnalysis, type VideoJob } from '../lib/api'
import { apiUrl } from '../lib/audio'

const STAGES: { key: VideoJob['stage']; label: string }[] = [
  { key: 'transcribing', label: 'Listening to the audio (Cartesia)' },
  { key: 'key_frames', label: 'Picking key frames, blurring faces' },
  { key: 'claude', label: 'Claude is breaking it into steps' },
  { key: 'saving', label: 'Saving the tasks' },
  { key: 'recording_voice', label: 'Recording the voice (Cartesia)' },
]

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Supervisor: a narrated demo video → tasks → steps. Demo video built in; upload your own. */
export function VideoPage() {
  const [params, setParams] = useSearchParams()
  const [demo, setDemo] = useState<{ available: boolean; url?: string; name?: string; duration?: number } | null>(null)
  const [past, setPast] = useState<{ video_id: string; name: string; created_at: number; tasks: { task_id: string; title: string; steps: number }[] }[]>([])
  const [job, setJob] = useState<VideoJob | null>(null)
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState<string | null>(null)
  const player = useRef<HTMLVideoElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const selected = params.get('v')

  const refreshPast = () => api.videos().then(setPast).catch(() => {})
  useEffect(() => {
    api.videoDemo().then(setDemo).catch((e) => setError(`Edge app not reachable: ${e.message}`))
    void refreshPast()
  }, [])

  // show a saved analysis (default: the demo one if it exists)
  useEffect(() => {
    const id = selected ?? (past.find((p) => p.video_id === 'demo_supervisor') ? 'demo_supervisor' : null)
    if (!id || job) return
    api.video(id).then(setAnalysis).catch(() => setAnalysis(null))
  }, [selected, past, job])

  // poll a running job
  useEffect(() => {
    if (!job || job.stage === 'done' || job.stage === 'failed') return
    const t = setTimeout(async () => {
      try {
        const j = await api.videoJob(job.job_id)
        setJob(j)
        if (j.stage === 'done' && j.result) {
          setAnalysis(j.result)
          setParams({ v: j.video_id })
          void refreshPast()
          setJob(null)
        }
        if (j.stage === 'failed') setError(j.error ?? 'Analysis failed')
      } catch (e) {
        setError(String((e as Error).message))
      }
    }, 1200)
    return () => clearTimeout(t)
  }, [job, setParams])

  const start = async (fn: () => Promise<VideoJob>) => {
    setError(null)
    setAnalysis(null)
    try {
      setJob(await fn())
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  const seek = (s: number) => {
    if (!player.current) return
    player.current.currentTime = s
    void player.current.play().catch(() => {})
  }

  const running = job && job.stage !== 'done' && job.stage !== 'failed'
  const videoSrc = analysis?.video_url ? apiUrl(analysis.video_url) : !analysis && demo?.available && demo.url ? apiUrl(demo.url) : null

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Video breakdown</h1>
          <p className="muted">Record yourself doing the task and talking through it. Claude watches the video and listens to you, then breaks it into steps.</p>
        </div>
        {past.length > 0 && (
          <select className="search" style={{ width: 'auto' }} value={selected ?? analysis?.video_id ?? ''} onChange={(e) => setParams({ v: e.target.value })} aria-label="Past videos">
            <option value="" disabled>
              Past videos…
            </option>
            {past.map((p) => (
              <option key={p.video_id} value={p.video_id}>
                {p.name} · {new Date(p.created_at * 1000).toLocaleString()}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="consent-banner missing" role="alert">
          {error}
        </div>
      )}

      <div className="coach-top">
        <Panel title={analysis ? analysis.name : demo?.available ? `Demo video · ${demo.name}` : 'Video'}>
          {videoSrc ? (
            <video ref={player} className="video-player" src={videoSrc} controls playsInline preload="metadata" />
          ) : analysis?.raw_video_deleted ? (
            <div className="thumbs">
              {analysis.frames.map((f) => (
                <figure key={f.url} className="thumb">
                  <img src={apiUrl(f.url)} alt={`Key frame at ${f.t.toFixed(1)} s`} />
                  <figcaption>{mmss(f.t)}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">No video yet.</p>
          )}
          {analysis?.raw_video_deleted && <p className="small muted">The uploaded video was deleted after analysis. Only these blurred key frames were kept.</p>}
        </Panel>
        <Panel title="Analyze">
          <div className="stack">
            {demo?.available && (
              <button className="btn btn-primary btn-xl btn-block" disabled={!!running} onClick={() => start(api.analyzeDemo)}>
                {analysis?.video_id === 'demo_supervisor' ? 'Analyze the demo video again' : 'Analyze the demo video'}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
              className="visually-hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setUploadName(f.name)
                void start(() => api.uploadVideo(f))
                e.target.value = ''
              }}
            />
            <button className="btn btn-secondary btn-block" disabled={!!running} onClick={() => fileInput.current?.click()}>
              ⬆ Upload a video
            </button>
            <p className="small muted">.mp4, .mov or .webm, up to 10 minutes. Uploaded videos are deleted after the steps are made; faces are blurred in the photos that are kept.</p>
            {running && (
              <ol className="stage-list" aria-live="polite">
                {uploadName && job?.video_id.startsWith('up_') && <li className="small muted">Uploaded {uploadName}</li>}
                {STAGES.map((s) => {
                  const idx = STAGES.findIndex((x) => x.key === job!.stage)
                  const me = STAGES.findIndex((x) => x.key === s.key)
                  const state = me < idx ? 'done' : me === idx ? 'now' : 'todo'
                  return (
                    <li key={s.key} className={`stage stage-${state}`}>
                      <span className="dot" aria-hidden /> {s.label}
                      {job!.stages_ms[s.key] !== undefined && <span className="small muted num"> · {fmtLatency(job!.stages_ms[s.key])}</span>}
                    </li>
                  )
                })}
              </ol>
            )}
            {analysis && !running && (
              <div className="row small">
                <TierBadge tier="cartesia" latency_ms={analysis.timings_ms.speech_to_text} />
                <span className="muted">speech-to-text</span>
                <TierBadge tier="claude" latency_ms={analysis.timings_ms.claude} />
                <span className="muted">steps</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {analysis && (
        <>
          {analysis.tasks.map((t) => (
            <TaskSteps key={t.task_id} task={t} onSeek={videoSrc ? seek : undefined} />
          ))}
          <Panel title="What the supervisor said">
            <ul className="transcript">
              {analysis.transcript.map((s, i) => (
                <li key={i}>
                  <button className="btn btn-ghost small num" style={{ minHeight: 32, padding: '2px 8px' }} onClick={() => seek(s.start)} disabled={!videoSrc}>
                    {mmss(s.start)}
                  </button>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
            {analysis.transcript_clean && (
              <p className="small muted" style={{ marginTop: 10 }}>
                Cleaned by Claude: “{analysis.transcript_clean}”
              </p>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

function TaskSteps({ task, onSeek }: { task: Task; onSeek?: (s: number) => void }) {
  return (
    <Panel
      title={task.title}
      actions={
        <>
          <Link className="btn btn-primary" to={`/steps/${task.task_id}`}>
            Open worker steps page →
          </Link>
          <Link className="btn btn-secondary" to={`/coach?task=${task.task_id}`}>
            Coach with camera
          </Link>
          <Link className="btn btn-ghost" to="/teach">
            Edit in Teach
          </Link>
        </>
      }
    >
      {task.summary && <p className="muted" style={{ marginBottom: 14 }}>{task.summary}</p>}
      <ol className="timeline">
        {task.steps.map((s, i) => (
          <li key={s.id} className="timeline-step">
            <div className="timeline-rail" aria-hidden>
              <span className="step-num">{i + 1}</span>
            </div>
            <article className="panel step-edit">
              <div className="stack" style={{ gap: 6 }}>
                <img src={apiUrl(s.reference_photo)} alt={`Step ${i + 1}: ${s.done_right}`} />
                {s.start_s !== undefined && (
                  <button className="btn btn-ghost small num" onClick={() => onSeek?.(s.start_s!)} disabled={!onSeek}>
                    ▶ {mmss(s.start_s)}–{mmss(s.end_s ?? s.start_s)}
                  </button>
                )}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <h3 style={{ fontSize: 22 }}>{s.instruction}</h3>
                <div className="small">
                  <span className="muted">Done right:</span> {s.done_right}
                </div>
                <div className="small">
                  <span className="muted">If:</span> {s.common_mistake} → <span style={{ color: 'var(--almost)' }}>“{s.correction}”</span>
                </div>
                <div className="small">
                  <span className="muted">Why:</span> {s.why}
                </div>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
