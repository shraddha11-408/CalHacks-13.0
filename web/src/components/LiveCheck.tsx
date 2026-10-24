import { useCallback, useEffect, useRef, useState } from 'react'
import { asTier } from '../format'
import { api, type CheckResult, type PublicConfig, type StepPayload } from '../lib/api'
import type { Say } from '../lib/audio'
import { TriggerEngine, type Area, type TriggerState } from '../lib/triggers'
import { grab, snapshot, type FrameRing } from '../lib/vision'
import { CameraStage, type FrameInfo } from './CameraStage'
import { TierBadge, VerdictPill } from './ui'

export interface Mark {
  /** [x, y, w, h] in video fractions, or null while the pointer is still looking */
  box: number[] | null
  wrong: string
  fix: string
  at: number
}

const readArea = (): Area => {
  try {
    return JSON.parse(localStorage.getItem('stepwise-work-area') ?? 'null') ?? { x: 0, y: 0, w: 1, h: 1 }
  } catch {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
}

/** Snapshot box (fractions of the work-area crop) → fractions of the full video frame. */
const toVideoBox = (b: number[], a: Area) => [a.x + b[0] * a.w, a.y + b[1] * a.h, b[2] * a.w, b[3] * a.h]

/** Amber box on the live video + a callout: what's wrong, what to do instead. Never red. */
export function MistakeMark({ mark }: { mark: Mark | null }) {
  if (!mark) return null
  const [x, y, w, h] = mark.box ?? [0, 0, 0, 0]
  return (
    <>
      {mark.box && (
        <div className="mistake-box" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} aria-hidden>
          <span className="mistake-tag">Fix this</span>
        </div>
      )}
      <div className="mistake-callout" role="alert">
        <div>
          <span className="mistake-label">Almost</span> {mark.wrong}
        </div>
        <div>
          <span className="mistake-label do">Do this</span> {mark.fix}
        </div>
        {!mark.box && <div className="small" style={{ opacity: 0.8 }}>Finding the spot…</div>}
      </div>
    </>
  )
}

const PHASE = { no_hands: 'No hands', moving: 'Hands moving', still: 'Hands still', busy: 'Bitdeer is checking…' } as const

/**
 * Live camera check for the worker Steps page. Bitdeer checks a face-blurred snapshot of the
 * work area when the hands pause, leave the work area, or every live_interval_s seconds.
 * A mistake is spoken right away (pre-recorded correction) and marked on the video.
 */
export function LiveCheck({
  cfg,
  sessionId,
  onSay,
  onStep,
  onFinished,
}: {
  cfg: PublicConfig
  sessionId: string
  onSay: (s: Say[]) => void
  onStep: (p: StepPayload) => void
  onFinished: () => void
}) {
  const ring = useRef<FrameRing | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const engine = useRef<TriggerEngine | null>(null)
  const busy = useRef(false)
  const [trig, setTrig] = useState<TriggerState | null>(null)
  const [last, setLast] = useState<CheckResult | null>(null)
  const [mark, setMark] = useState<Mark | null>(null)
  const [flash, setFlash] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [recheck, setRecheck] = useState(0) // bumps → a second look ~1 s after a first "done"

  useEffect(() => {
    engine.current = new TriggerEngine({ ...cfg.coach, timeout_s: cfg.coach.live_interval_s }, performance.now() / 1000)
  }, [cfg])

  const check = useCallback(
    async (trigger: string) => {
      if (busy.current) return
      busy.current = true
      if (engine.current) engine.current.busy = true
      setFlash((n) => n + 1)
      try {
        const area = readArea()
        const f = ring.current?.sharpest(performance.now() / 1000, 1.0)
        const src = f?.canvas ?? (video.current ? grab(video.current) : null)
        if (!src) throw new Error('no camera frame')
        const { jpeg } = await snapshot(src, area, cfg.coach.snapshot_px)
        const r = await api.check(sessionId, jpeg, trigger)
        setLast(r)
        setErr(null)
        if (r.status === 'mistake') {
          onSay(r.say) // voice first: never wait for the mark
          const wrong = r.reason || 'Something needs fixing.'
          const fix = r.fix || r.say[0]?.text || ''
          const bitdeerBox = cfg.coach.mark_with === 'bitdeer' && r.box ? toVideoBox(r.box, area) : null
          const at = Date.now()
          setMark({ box: bitdeerBox, wrong, fix, at })
          if (!bitdeerBox) {
            api
              .locate(sessionId, jpeg, wrong)
              .then((l) => setMark((m) => (m && m.at === at ? { ...m, box: l.box ? toVideoBox(l.box, area) : null, fix: m.fix || l.fix } : m)))
              .catch(() => {})
          }
        } else if (r.status === 'confirming') {
          // first "done": take a second look in ~1 s before moving on (debounce)
          setRecheck((n) => n + 1)
        } else if (r.status === 'finished') {
          setMark(null)
          onFinished()
        } else if (r.status === 'done' || r.status === 'skipped') {
          setMark(null)
          if (r.say?.length) onSay(r.say)
          if (r.finished) onFinished()
          else if (r.next) onStep(r.next)
        } else if (r.status === 'in_progress') {
          // keep a mark up until the worker has had time to fix it, then clear
          setMark((m) => (m && Date.now() - m.at > 6000 ? null : m))
        } else if (r.say?.length) {
          onSay(r.say)
        }
      } catch (e) {
        setErr(`Check failed: ${(e as Error).message}`)
      } finally {
        busy.current = false
        if (engine.current) {
          engine.current.busy = false
          engine.current.markChecked(performance.now() / 1000)
        }
      }
    },
    [cfg, sessionId, onSay, onStep, onFinished],
  )

  // second look after a first "done" (debounce): state-driven so the latest `check` runs
  useEffect(() => {
    if (!recheck) return
    const t = window.setTimeout(() => void check('confirm'), 1200)
    return () => window.clearTimeout(t)
  }, [recheck, check])

  const onFrame = useCallback(
    ({ hands, t, area }: FrameInfo) => {
      const e = engine.current
      if (!e) return
      const s = e.update(hands, t, area)
      setTrig(s)
      if (s.trigger) void check(s.trigger)
    },
    [check],
  )

  return (
    <div className="stack" style={{ gap: 10 }}>
      <CameraStage
        ringRef={ring}
        videoRef={video}
        onFrame={onFrame}
        overlay={
          <>
            {flash > 0 && <div key={flash} className="flash" />}
            <MistakeMark mark={mark} />
            <div className="cam-badge">
              {trig && (
                <span className="cam-chip">
                  <span className={`dot ${trig.phase === 'still' ? 'dot-ok' : trig.phase === 'busy' ? 'dot-degraded' : 'dot-off'}`} aria-hidden />
                  {PHASE[trig.phase]}
                </span>
              )}
            </div>
          </>
        }
      />
      <div className="row small" style={{ gap: 8 }}>
        {last ? (
          <>
            <VerdictPill status={last.status} />
            <TierBadge tier={asTier(last.source)} latency_ms={last.latency_ms} />
            <span className="muted">{last.reason}</span>
          </>
        ) : (
          <span className="muted">Bitdeer checks when your hands pause, and every {cfg.coach.live_interval_s} seconds.</span>
        )}
        <button className="btn btn-ghost" onClick={() => check('button')}>
          Check now
        </button>
      </div>
      {err && (
        <p className="small" role="alert" style={{ color: 'var(--almost)' }}>
          {err}
        </p>
      )}
    </div>
  )
}
