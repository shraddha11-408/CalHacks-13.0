import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Area, Pt } from '../lib/triggers'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { detectHands, FrameRing, loadHands } from '../lib/vision'
import { getMedia } from '../lib/media'
import { openGlasses, type GlassesStream } from '../lib/glasses'

const AREA_KEY = 'stepwise-work-area' // the active camera's area: what LiveCheck, Teach and Coach crop to
const CAM_KEY = 'stepwise-camera'
const GLASSES = 'glasses' // camera choice: the Pi 5 + Brio 100 on the glasses, via the edge app
const DEFAULT_AREA: Area = { x: 0.15, y: 0.2, w: 0.7, h: 0.72 }
// The glasses look where the head looks, so by default they keep the whole frame. (At the Pi's old 640x480,
// the desk-webcam crop left 336x460 px for the model, under live_snapshot_px 768.)
const GLASSES_AREA: Area = { x: 0, y: 0, w: 1, h: 1 }

const isGlasses = (deviceId: string) => deviceId === GLASSES
const defaultArea = (deviceId: string) => (isGlasses(deviceId) ? GLASSES_AREA : DEFAULT_AREA)

/** Each camera keeps its own area (a desk webcam and head-worn glasses frame the table differently). */
function readArea(deviceId: string): Area {
  const keys = isGlasses(deviceId) ? [`${AREA_KEY}-glasses`] : [`${AREA_KEY}-webcam`, AREA_KEY]
  for (const k of keys) {
    try {
      const a = JSON.parse(localStorage.getItem(k) ?? '')
      if (a && typeof a.x === 'number') return a
    } catch {
      /* next */
    }
  }
  return defaultArea(deviceId)
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
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(CAM_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const areaSource = file ? '' : deviceId // an uploaded video uses the webcam's area
  const [area, setArea] = useState<Area>(() => readArea(areaSource))
  const areaRef = useRef(area)
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<{ x0: number; y0: number } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [status, setStatus] = useState<'starting' | 'ok' | 'denied' | 'error'>('starting')
  const [ended, setEnded] = useState(false)
  // The box takes the video's own shape, so the work area and mistake boxes (in % of the box) line up
  // with the crop (in % of the frame). A fixed 16:9 box letterboxed the portrait glasses picture.
  const [shape, setShape] = useState<{ w: number; h: number } | null>(null)
  const [err, setErr] = useState('')
  const onFrameRef = useRef(onFrame)

  useEffect(() => {
    onFrameRef.current = onFrame
  })
  useEffect(() => {
    areaRef.current = area
    try {
      localStorage.setItem(AREA_KEY, JSON.stringify(area))
      localStorage.setItem(`${AREA_KEY}-${isGlasses(areaSource) ? 'glasses' : 'webcam'}`, JSON.stringify(area))
    } catch {
      /* storage blocked */
    }
  }, [area, areaSource])

  // camera, or the uploaded video
  useEffect(() => {
    let stream: MediaStream | null = null
    let glasses: GlassesStream | null = null
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
        setStatus('starting')
        if (deviceId === GLASSES) {
          glasses = await openGlasses()
          stream = glasses.stream
        } else {
          stream = await getMedia({
            video: deviceId ? { deviceId: { exact: deviceId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
            audio: false,
          })
        }
        if (cancelled) {
          glasses?.stop()
          stream.getTracks().forEach((t) => t.stop())
          return
        }
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
      glasses?.stop()
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
        style={
          shape
            ? shape.h > shape.w
              ? { aspectRatio: `${shape.w} / ${shape.h}`, height: 'min(72vh, 900px)', width: 'auto', maxWidth: '100%', marginInline: 'auto' }
              : { aspectRatio: `${shape.w} / ${shape.h}` }
            : undefined
        }
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
          setArea((a) => (a.w < 0.1 || a.h < 0.1 ? defaultArea(areaSource) : a))
        }}
      >
        <video
          ref={video}
          muted
          playsInline
          className="cam-video"
          onLoadedMetadata={(e) => setShape({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => setShape({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
        />
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
            {status === 'error' && (deviceId === GLASSES ? `${err} Or pick another camera below.` : `Camera error: ${err}`)}
          </div>
        )}
      </div>
      {editable && (
        <div className="row small">
          <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? 'Drag over the table…' : '▭ Set work area'}
          </button>
          {!file && (
            <label className="row small" style={{ gap: 6 }}>
              Camera
              <select
                className="search"
                style={{ width: 'auto', minHeight: 40, padding: '4px 8px' }}
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value)
                  setArea(readArea(e.target.value))
                  try {
                    localStorage.setItem(CAM_KEY, e.target.value)
                  } catch {
                    /* ok */
                  }
                }}
              >
                <option value="">Default</option>
                <option value={GLASSES}>Glasses (Pi)</option>
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
