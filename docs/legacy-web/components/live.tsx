import { useState, type MouseEvent } from 'react'
import type { PipelineStats } from '../edge'
import { fmtLatency } from '../format'

const GATE_WORD = { moving: 'Moving', settling: 'Settling', settled: 'Still' } as const

/** Live rectified tray (MJPEG from the edge). In calibrate mode, clicks report a normalized point. */
export function LiveTray({ onPick, calibrating }: { onPick?: (x: number, y: number) => void; calibrating?: boolean }) {
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null)
  const click = (e: MouseEvent<HTMLImageElement>) => {
    if (!calibrating || !onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    setPt({ x, y })
    onPick(x, y)
  }
  return (
    <div className="live-wrap">
      <img
        className={`live-img ${calibrating ? 'calibrating' : ''}`}
        src="/api/stream/tray.mjpg"
        alt="Live rectified tray view"
        onClick={click}
        draggable={false}
      />
      {calibrating && pt && <span className="pick-dot" style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }} aria-hidden />}
    </div>
  )
}

/** Raw camera with marker + gate overlays. Local only: it shows the room. */
export function LiveRaw() {
  return <img className="live-img" src="/api/stream/raw.mjpg" alt="Camera view with marker and gate overlays (local only)" />
}

export function GateChip({ stats }: { stats: PipelineStats | null }) {
  if (!stats) return <span className="badge-soft">Camera offline</span>
  const markers = stats.markers.length
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className={`gate-chip gate-${stats.gate_state}`}>
        <span className="dot" aria-hidden /> {GATE_WORD[stats.gate_state]}
      </span>
      <span className={markers === 4 ? 'badge-claimed' : 'verdict verdict-almost'}>{markers === 4 ? 'Tray found' : `Markers ${markers}/4`}</span>
      {stats.gate_rectify_ms_p50 !== null && (
        <span className="small muted num" title="Gate + marker detection + rectify, per frame, measured live">
          gate+rectify {fmtLatency(stats.gate_rectify_ms_p50)} p50 · {fmtLatency(stats.gate_rectify_ms_p99 ?? 0)} p99 · {stats.fps} fps
        </span>
      )}
    </span>
  )
}

interface Sample {
  lo: number[]
  hi: number[]
  rgb: number[]
}

const ITEMS = ['soap', 'shampoo', 'lotion', 'cloth']

/** HSV calibration: click an item on the live tray, check the range, save it to config.yaml. */
export function HsvCalibrator({ sample, error, onDone }: { sample: Sample | null; error: string | null; onDone: () => void }) {
  const [item, setItem] = useState('soap')
  const [saved, setSaved] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const save = async () => {
    if (!sample) return
    setSaveErr(null)
    try {
      const r = await fetch('/api/calibrate/hsv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item, lo: sample.lo, hi: sample.hi }),
      })
      if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText)
      setSaved(item)
    } catch (e) {
      setSaveErr(String((e as Error).message))
    }
  }
  return (
    <div className="panel calibrator stack" style={{ gap: 10 }}>
      <div className="spread">
        <h3>Calibrate colors</h3>
        <button className="btn btn-ghost" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="small muted">Click an item on the tray picture. Then pick its name and save.</p>
      {error && (
        <p className="small" role="alert" style={{ color: 'var(--almost)' }}>
          {error}
        </p>
      )}
      {sample && (
        <>
          <div className="row">
            <span className="swatch" style={{ background: `rgb(${sample.rgb.join(',')})` }} aria-hidden />
            <span className="mono small">
              H {sample.lo[0]}–{sample.hi[0]} · S {sample.lo[1]}–{sample.hi[1]} · V {sample.lo[2]}–{sample.hi[2]}
            </span>
          </div>
          <div className="row">
            <label htmlFor="hsv-item" className="small">
              This is the
            </label>
            <select id="hsv-item" className="search" style={{ width: 'auto', minHeight: 44 }} value={item} onChange={(e) => setItem(e.target.value)}>
              {ITEMS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={save}>
              Save to config
            </button>
          </div>
          {saved && (
            <p className="small" role="status" style={{ color: 'var(--success)' }}>
              Saved “{saved}” to config.yaml.
            </p>
          )}
          {saveErr && (
            <p className="small" role="alert" style={{ color: 'var(--almost)' }}>
              {saveErr}
            </p>
          )}
        </>
      )}
    </div>
  )
}
