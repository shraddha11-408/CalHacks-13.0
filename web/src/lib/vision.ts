// Browser real-time layer (PLAN.md §2): MediaPipe hands + face detection, frame
// ring with sharpness, and privacy-safe snapshots. Models and WASM are served
// from /public so the coach loop works offline on the hotspot.
import { FaceDetector, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Area, Pt } from './triggers'

let handsP: Promise<HandLandmarker> | null = null
let facesP: Promise<FaceDetector> | null = null
const fileset = () => FilesetResolver.forVisionTasks('/mediapipe-wasm')

type Delegate = 'GPU' | 'CPU'
/** GPU first; some machines/browsers have no WebGL for MediaPipe, so fall back to CPU. */
async function gpuOrCpu<T>(make: (d: Delegate) => Promise<T>): Promise<T> {
  try {
    return await make('GPU')
  } catch {
    return await make('CPU')
  }
}

export function loadHands(): Promise<HandLandmarker> {
  handsP ??= fileset().then((fs) =>
    gpuOrCpu((delegate) =>
      HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
    ),
  )
  return handsP
}

export function loadFaces(): Promise<FaceDetector> {
  facesP ??= fileset().then((fs) =>
    gpuOrCpu((delegate) =>
      FaceDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.6,
      }),
    ),
  )
  return facesP
}

export function detectHands(h: HandLandmarker, video: HTMLVideoElement, ts: number): Pt[][] {
  const r = h.detectForVideo(video, ts)
  return r.landmarks.map((hand) => hand.map((p) => ({ x: p.x, y: p.y })))
}

/** Variance of a 4-neighbour Laplacian on a small grayscale copy: higher = sharper. */
export function sharpness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  let sum = 0
  let sq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      sum += l
      sq += l * l
      n++
    }
  }
  const mean = sum / n
  return sq / n - mean * mean
}

export interface RingFrame {
  t: number
  canvas: HTMLCanvasElement
  sharp: number
}

/** Last N frames (scaled copies) with sharpness of the work area, so a snapshot can pick the sharpest. */
export class FrameRing {
  private frames: RingFrame[] = []
  private probe = document.createElement('canvas')
  private size: number
  private width: number

  constructor(size = 12, width = 1280) {
    this.size = size
    this.width = width
    this.probe.width = 128
    this.probe.height = 96
  }

  push(video: HTMLVideoElement, t: number, area: Area) {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return
    const scale = Math.min(1, this.width / vw)
    const reuse = this.frames.length >= this.size ? this.frames.shift()!.canvas : document.createElement('canvas')
    reuse.width = Math.round(vw * scale)
    reuse.height = Math.round(vh * scale)
    const ctx = reuse.getContext('2d', { willReadFrequently: false })!
    ctx.drawImage(video, 0, 0, reuse.width, reuse.height)
    const pctx = this.probe.getContext('2d', { willReadFrequently: true })!
    pctx.drawImage(reuse, area.x * reuse.width, area.y * reuse.height, area.w * reuse.width, area.h * reuse.height, 0, 0, 128, 96)
    this.frames.push({ t, canvas: reuse, sharp: sharpness(pctx, 128, 96) })
  }

  /** Sharpest frame from roughly the last `withinS` seconds (the pause). */
  sharpest(now: number, withinS = 1.0): RingFrame | null {
    const recent = this.frames.filter((f) => now - f.t <= withinS)
    const pool = recent.length ? recent : this.frames.slice(-1)
    return pool.reduce<RingFrame | null>((best, f) => (!best || f.sharp > best.sharp ? f : best), null)
  }
}

/**
 * Privacy-safe snapshot: blur every detected face on the full frame, then crop
 * to the work area and resize so the long side is `px`. Only this leaves the browser.
 */
export async function snapshot(src: HTMLCanvasElement, area: Area | null, px: number): Promise<{ jpeg: string; faces: number }> {
  const work = document.createElement('canvas')
  work.width = src.width
  work.height = src.height
  const wctx = work.getContext('2d')!
  wctx.drawImage(src, 0, 0)
  let faces = 0
  let fd: FaceDetector
  try {
    fd = await loadFaces()
  } catch {
    // privacy rule: faces are blurred before any frame leaves the browser. No blur → no photo.
    throw new Error('face blur is unavailable, so no photo was sent')
  }
  {
    let det: ReturnType<FaceDetector['detect']>
    try {
      det = fd.detect(work)
    } catch {
      throw new Error('face blur is unavailable, so no photo was sent')
    }
    for (const d of det.detections) {
      const b = d.boundingBox
      if (!b) continue
      faces++
      // Blur just the face box (small pad). A big padded grey patch also wiped out task objects
      // when printed faces (e.g. a logo on a cup sleeve) were detected.
      const pad = 0.08
      const x = Math.max(0, b.originX - b.width * pad)
      const y = Math.max(0, b.originY - b.height * pad)
      const w = Math.min(work.width - x, b.width * (1 + 2 * pad))
      const h = Math.min(work.height - y, b.height * (1 + 2 * pad))
      wctx.save()
      wctx.beginPath()
      wctx.rect(x, y, w, h)
      wctx.clip()
      wctx.filter = 'blur(24px)'
      wctx.drawImage(work, 0, 0)
      wctx.restore()
    }
  }
  const a = area ?? { x: 0, y: 0, w: 1, h: 1 }
  const sx = a.x * work.width
  const sy = a.y * work.height
  const sw = a.w * work.width
  const sh = a.h * work.height
  const scale = px / Math.max(sw, sh)
  const out = document.createElement('canvas')
  out.width = Math.round(sw * Math.min(1, scale))
  out.height = Math.round(sh * Math.min(1, scale))
  out.getContext('2d')!.drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return { jpeg: out.toDataURL('image/jpeg', 0.85), faces }
}

/** Grab the current video frame into a canvas. */
export function grab(video: HTMLVideoElement, width = 1280): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const scale = Math.min(1, width / (video.videoWidth || width))
  c.width = Math.round((video.videoWidth || 640) * scale)
  c.height = Math.round((video.videoHeight || 480) * scale)
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
  return c
}
