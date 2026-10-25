// Always-on microphone for the worker page. Energy-based voice activity detection:
// an adaptive noise floor, speech = clearly above it. Each utterance is recorded on its
// own (MediaRecorder) and handed over as one Blob for speech-to-text.
// Paused while the app is speaking or thinking, so it doesn't hear its own voice
// (the server also drops anything that matches what the app just said).

import { getMedia } from './media'

export type ListenPhase = 'off' | 'listening' | 'hearing' | 'paused'

export interface ListenerOptions {
  onUtterance: (audio: Blob) => void
  /** true while the app is talking or waiting for an answer */
  isBlocked: () => boolean
  onPhase?: (p: ListenPhase) => void
  minSpeechMs?: number
  endSilenceMs?: number
  maxMs?: number
}

const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''

export class Listener {
  private o: Required<ListenerOptions>
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private an: AnalyserNode | null = null
  private timer: number | undefined
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private floor = 0.01
  private loudMs = 0
  private recStart = 0
  private lastLoud = 0
  private discard = false
  private phase: ListenPhase = 'off'
  private blockedUntil = 0

  constructor(opts: ListenerOptions) {
    this.o = { onPhase: () => {}, minSpeechMs: 400, endSilenceMs: 800, maxMs: 10000, ...opts }
  }

  async start() {
    this.stream = await getMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    this.ctx = new AudioContext()
    this.an = this.ctx.createAnalyser()
    this.an.fftSize = 1024
    this.ctx.createMediaStreamSource(this.stream).connect(this.an)
    this.timer = window.setInterval(() => this.tick(), 50)
    this.set('listening')
  }

  stop() {
    window.clearInterval(this.timer)
    this.discard = true
    if (this.rec?.state === 'recording') this.rec.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.stream = null
    this.ctx = null
    this.set('off')
  }

  private set(p: ListenPhase) {
    if (p !== this.phase) {
      this.phase = p
      this.o.onPhase(p)
    }
  }

  private rms(): number {
    const buf = new Float32Array(this.an!.fftSize)
    this.an!.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    return Math.sqrt(sum / buf.length)
  }

  private tick() {
    if (!this.an) return
    const now = performance.now()
    const level = this.rms()
    if (this.o.isBlocked()) {
      this.blockedUntil = now + 600 // tail: the room still rings after the speaker stops
    }
    if (now < this.blockedUntil) {
      if (this.rec?.state === 'recording') {
        this.discard = true
        this.rec.stop()
      }
      this.loudMs = 0
      this.set('paused')
      return
    }
    const recording = this.rec?.state === 'recording'
    if (!recording) this.floor = this.floor * 0.97 + Math.min(level, 0.2) * 0.03
    const threshold = Math.max(0.015, this.floor * 3)
    this.loudMs = level > threshold ? this.loudMs + 50 : 0

    if (!recording) {
      this.set('listening')
      if (this.loudMs >= 100) this.begin(now)
      return
    }
    if (level > threshold * 0.6) this.lastLoud = now
    if (now - this.lastLoud > this.o.endSilenceMs || now - this.recStart > this.o.maxMs) {
      this.discard = this.lastLoud - this.recStart < this.o.minSpeechMs // a cough or a click
      this.rec!.stop()
    }
  }

  private begin(now: number) {
    if (!this.stream) return
    const mimeType = pickMime()
    this.chunks = []
    this.discard = false
    this.recStart = now
    this.lastLoud = now
    const rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType || mimeType || 'audio/webm' })
      if (!this.discard && blob.size > 2000) this.o.onUtterance(blob)
      if (this.stream) this.set('listening')
    }
    rec.start(250)
    this.rec = rec
    this.set('hearing')
  }
}
