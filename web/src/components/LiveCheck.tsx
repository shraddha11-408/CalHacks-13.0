import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { asTier } from '../format'
import { api, type CheckResult, type PublicConfig, type StepPayload } from '../lib/api'
import type { Say, SpeechKind } from '../lib/audio'
import { TriggerEngine, type Area, type TriggerState } from '../lib/triggers'
import { grab, snapshot, type FrameRing } from '../lib/vision'
import { CameraStage, type FrameInfo } from './CameraStage'
import { TierBadge, VerdictPill } from './ui'

export interface LoggedMistake {
  stepIndex: number
  what: string
  fix: string
  photo: string | null
  at: number
}

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

/** the edge's 404 for a session it doesn't hold (in memory only, so any edge restart drops it) */
export const SESSION_LOST = 'session ended or unknown'

const PHASE = { no_hands: 'No hands', moving: 'Hands moving', still: 'Hands still', busy: 'Hands' } as const

/**
 * Live camera check for the worker Steps page. Continuous: a face-blurred frame of the work area
 * goes to a fast vision model (Claude Sonnet, or Gemini Flash; Bitdeer is paused) every
 * live_interval_s, with up to live_parallel checks in flight, so nobody waits for a pause.
 * The model sees the whole step list; answers about a step that already changed are dropped.
 * A mistake is spoken right away (pre-recorded correction) and marked on the video.
 */
export function LiveCheck({
  cfg,
  sessionId,
  onSay,
  onStep,
  onFinished,
  onMistake,
  videoRef,
  file = null,
  onSessionLost,
}: {
  cfg: PublicConfig
  sessionId: string
  onSay: (s: Say[], kind: SpeechKind) => void
  onStep: (p: StepPayload) => void
  onFinished: () => void
  /** one call per spoken correction (repeats inside the 10 s cooldown are not reported) */
  onMistake?: (m: LoggedMistake) => void
  /** shares the camera <video> with the parent (e.g. for a help photo) */
  videoRef?: MutableRefObject<HTMLVideoElement | null>
  /** an uploaded video stands in for the camera */
  file?: File | null
  /** the edge no longer knows this session (it restarted): the parent starts a new one at the same step */
  onSessionLost?: () => void
}) {
  const ring = useRef<FrameRing | null>(null)
  const ownVideo = useRef<HTMLVideoElement | null>(null)
  const video = videoRef ?? ownVideo
  const engine = useRef<TriggerEngine | null>(null)
  const inflight = useRef(0)
  const lastStart = useRef(0)
  const backoffUntil = useRef(0)
  const seq = useRef(0)
  const applied = useRef(0) // newest check whose answer is shown (answers can arrive out of order)
  const [trig, setTrig] = useState<TriggerState | null>(null)
  const [last, setLast] = useState<CheckResult | null>(null)
  const [mark, setMark] = useState<Mark | null>(null)
  const [flash, setFlash] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    // the engine only reads the hands now (pause = check right away); the stream itself never waits for a pause
    engine.current = new TriggerEngine({ ...cfg.coach, timeout_s: 1e9 }, performance.now() / 1000)
  }, [cfg])

  const check = useCallback(
    async (trigger: string) => {
      const explicit = trigger === 'button'
      if (!explicit && inflight.current >= cfg.coach.live_parallel) return
      inflight.current += 1
      lastStart.current = performance.now() / 1000
      const my = ++seq.current
      if (explicit) setFlash((n) => n + 1)
      try {
        const area = readArea()
        const f = ring.current?.sharpest(performance.now() / 1000, 0.25) // freshest sharp frame, not an old one
        const src = f?.canvas ?? (video.current ? grab(video.current) : null)
        if (!src) throw new Error('no camera frame')
        const { jpeg } = await snapshot(src, area, cfg.coach.live_snapshot_px)
        const r = await api.check(sessionId, jpeg, trigger)
        if (r.status === 'stale') return // the step moved on while this one was in flight
        if (r.status === 'rate_limited') {
          backoffUntil.current = performance.now() / 1000 + 3
          setErr('The vision model asked us to slow down. Checking a bit less often…')
          return
        }
        const older = my < applied.current
        if (!older) {
          applied.current = my
          setLast(r)
          setErr(null)
        }
        if (r.status === 'mistake') {
          if (r.say?.length && !older) onSay(r.say, 'correction') // voice first; a newer frame already answered → skip
          const wrong = r.reason || 'Something needs fixing.'
          const fix = r.fix || r.say[0]?.text || ''
          if (!r.repeat) onMistake?.({ stepIndex: r.step_index ?? 0, what: wrong, fix, photo: r.photo || null, at: Date.now() })
          const liveBox = cfg.coach.mark_with !== 'claude' && r.box ? toVideoBox(r.box, area) : null // box came with the check
          const at = Date.now()
          setMark({ box: liveBox, wrong, fix, at })
          if (!liveBox && cfg.coach.mark_with === 'claude') {
            api
              .locate(sessionId, jpeg, wrong)
              .then((l) => setMark((m) => (m && m.at === at ? { ...m, box: l.box ? toVideoBox(l.box, area) : null, fix: m.fix || l.fix } : m)))
              .catch(() => {})
          }
        } else if (r.status === 'finished') {
          setMark(null)
          onFinished()
        } else if (r.status === 'done' || r.status === 'skipped') {
          setMark(null)
          if (r.say?.length) onSay(r.say, 'advance')
          if (r.finished) onFinished()
          else if (r.next) onStep(r.next)
        } else if (r.status === 'in_progress' || r.status === 'confirming') {
          // "confirming": the next streamed frame is the second look. Keep a mark up a few seconds, then clear.
          if (!older) setMark((m) => (m && Date.now() - m.at > 4000 ? null : m))
          if (r.say?.length && !older) onSay(r.say, 'stuck') // stuck on this step: "Take your time." + the next small action
        } else if (r.say?.length) {
          onSay(r.say, 'stuck')
        }
      } catch (e) {
        const msg = (e as Error).message
        if (msg === SESSION_LOST && onSessionLost) {
          setErr('Reconnecting to the coach…')
          onSessionLost()
        } else setErr(`Check failed: ${msg}`)
        backoffUntil.current = performance.now() / 1000 + 1
      } finally {
        inflight.current -= 1
      }
    },
    [cfg, sessionId, onSay, onStep, onFinished, onMistake, onSessionLost, video],
  )

  const onFrame = useCallback(
    ({ hands, t, area }: FrameInfo) => {
      const e = engine.current
      if (!e) return
      const s = e.update(hands, t, area)
      setTrig(s)
      const now = performance.now() / 1000
      if (now < backoffUntil.current) return
      // continuous: a new check every live_interval_s (≤ live_parallel in flight); a hand pause checks at once
      if (s.trigger || now - lastStart.current >= cfg.coach.live_interval_s) void check(s.trigger ?? 'stream')
    },
    [check, cfg],
  )

  return (
    <div className="stack" style={{ gap: 10 }}>
      <CameraStage
        ringRef={ring}
        videoRef={video}
        onFrame={onFrame}
        file={file}
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
          <span className="muted">Watching live: a new look every {cfg.coach.live_interval_s} seconds.</span>
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
