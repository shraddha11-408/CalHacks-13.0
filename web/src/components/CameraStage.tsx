import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Area, Pt } from '../lib/triggers'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { detectHands, FrameRing, loadHands } from '../lib/vision'
import { getMedia } from '../lib/media'

const AREA_KEY = 'stepwise-work-area'
const CAM_KEY = 'stepwise-camera'
const DEFAULT_AREA: Area = { x: 0.15, y: 0.2, w: 0.7, h: 0.72 }

function readArea(): Area {
  try {
    const a = JSON.parse(localStorage.getItem(AREA_KEY) ?? '')
    if (a && typeof a.x === 'number') return a
  } catch {
    /* default */
  }
  return DEFAULT_AREA
}

export interface FrameInfo {
  hands: Pt[][]
  t: number
  area: Area
}

/**
 * Webcam + MediaPipe hands at ~15 fps, a work-area rectangle you can redraw by
 * dragging, and a ring of recent frames for sharp snapshots. The video never
 * leaves the browser; only snapshots made by lib/vision.snapshot do.
 */
export function CameraStage({
  onFrame,
  ringRef,
  videoRef,
  overlay,
  editable = true,
  file = null,
}: {
  onFrame?: (f: FrameInfo) => void
  ringRef?: React.MutableRefObject<FrameRing | null>
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>
  overlay?: React.ReactNode
  editable?: boolean
  /** a recorded video plays in place of the camera (demo: the worker uploads one per task) */
  file?: File | null
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [area, setArea] = useState<Area>(readArea)
  const areaRef = useRef(area)
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<{ x0: number; y0: number } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(CAM_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [status, setStatus] = useState<'starting' | 'ok' | 'denied' | 'error'>('starting')
  const [ended, setEnded] = useState(false)
  const [err, setErr] = useState('')
  const onFrameRef = useRef(onFrame)

  useEffect(() => {
    onFrameRef.current = onFrame
  })
  useEffect(() => {
    areaRef.current = area
    try {
      localStorage.setItem(AREA_KEY, JSON.stringify(area))
    } catch {
      /* storage blocked */
    }
  }, [area])

  // camera, or the uploaded video
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    let url = ''
    setEnded(false)
    ;(async () => {
      try {
        if (file) {
          const v = video.current!
          url = URL.createObjectURL(file)
          v.srcObject = null
          v.src = url
          v.onended = () => setEnded(true)
          await v.play()
          setStatus('ok')
          return
        }
        stream = await getMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
          audio: false,
        })
        if (cancelled) return
        const v = video.current!
        v.srcObject = stream
        await v.play()
        setStatus('ok')
        setDevices((await navigator.mediaDevices?.enumerateDevices() ?? []).filter((d) => d.kind === 'videoinput'))
      } catch (e) {
        const name = (e as Error).name
        setStatus(name === 'NotAllowedError' ? 'denied' : 'error')
        setErr(String((e as Error).message))
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (url) {
        const v = video.current
        if (v) {
          v.pause()
          v.removeAttribute('src')
          v.load()
        }
        URL.revokeObjectURL(url)
      }
    }
  }, [deviceId, file])

  // hand loop
  useEffect(() => {
    if (status !== 'ok') return
    let raf = 0
    let alive = true
    let last = 0
    const ring = new FrameRing()
    if (ringRef) ringRef.current = ring
    if (videoRef) videoRef.current = video.current
    // the live check streams frames on a timer, so the loop must run even if hand tracking can't load
    const run = (hl: HandLandmarker | null) => {
      const tick = (now: number) => {
        if (!alive) return
        raf = requestAnimationFrame(tick)
        const v = video.current
        if (!v || v.readyState < 2 || now - last < 66) return // ~15 fps
        last = now
        let hands: Pt[][] = []
        try {
          if (hl) hands = detectHands(hl, v, now)
        } catch {
          /* no hands this frame */
        }
        const t = now / 1000
        ring.push(v, t, areaRef.current)
        draw(canvas.current, v, hands)
        onFrameRef.current?.({ hands, t, area: areaRef.current })
      }
      raf = requestAnimationFrame(tick)
    }
    loadHands().then(run, () => run(null))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [status, ringRef, videoRef])

  const pt = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div
        className={`cam ${editing ? 'editing' : ''}`}
        onPointerDown={(e) => {
          if (!editing) return
          const p = pt(e)
          setDrag({ x0: p.x, y0: p.y })
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!editing || !drag) return
          const p = pt(e)
          setArea({ x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) })
        }}
        onPointerUp={() => {
          if (!editing) return
          setDrag(null)
          setEditing(false)
          setArea((a) => (a.w < 0.1 || a.h < 0.1 ? DEFAULT_AREA : a))
        }}
      >
        <video ref={video} muted playsInline className="cam-video" />
        <canvas ref={canvas} className="cam-overlay" aria-hidden />
        <div className="work-area" style={{ left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.w * 100}%`, height: `${area.h * 100}%` }}>
          <span>Work area</span>
        </div>
        {overlay}
        {file && ended && (
          <div className="cam-msg" role="status">
            Video ended.{' '}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setEnded(false)
                const v = video.current
                if (v) {
                  v.currentTime = 0
                  void v.play()
                }
              }}
            >
              Play again
            </button>
          </div>
        )}
        {status !== 'ok' && (
          <div className="cam-msg" role="status">
            {status === 'starting' && (file ? 'Loading video…' : 'Starting camera…')}
            {status === 'denied' && 'Camera blocked. Allow camera access for this site, then reload.'}
            {status === 'error' && `Camera error: ${err}`}
          </div>
        )}
      </div>
      {editable && (
        <div className="row small">
          <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? 'Drag over the table…' : '▭ Set work area'}
          </button>
          {!file && devices.length > 1 && (
            <label className="row small" style={{ gap: 6 }}>
              Camera
              <select
                className="search"
                style={{ width: 'auto', minHeight: 40, padding: '4px 8px' }}
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value)
                  try {
                    localStorage.setItem(CAM_KEY, e.target.value)
                  } catch {
                    /* ok */
                  }
                }}
              >
                <option value="">Default</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="muted">Video stays in this browser. Faces are blurred before any photo is sent.</span>
        </div>
      )}
    </div>
  )
}

function draw(c: HTMLCanvasElement | null, v: HTMLVideoElement, hands: Pt[][]) {
  if (!c) return
  if (c.width !== v.videoWidth) {
    c.width = v.videoWidth
    c.height = v.videoHeight
  }
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  for (const h of hands) {
    for (const p of h) {
      ctx.beginPath()
      ctx.arc(p.x * c.width, p.y * c.height, Math.max(3, c.width / 250), 0, Math.PI * 2)
      ctx.fillStyle = '#5cc2bc'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#062a29'
      ctx.stroke()
    }
  }
}
