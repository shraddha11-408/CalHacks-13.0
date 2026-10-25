// The glasses camera (Pi 5 + Brio 100) as a MediaStream, so everything that takes the webcam
// (hand tracking, frame ring, face-blurred snapshots, recording) takes it unchanged.
// The edge app passes the Pi's MJPEG through at /stream/glasses.mjpg (same origin: the page is
// https and the Pi is plain http with no CORS). JPEGs are split on their start/end markers,
// the same way the Pi's streamer splits ffmpeg's output, and drawn onto a canvas.

export const GLASSES_URL = '/api/stream/glasses.mjpg'

/** Splits a byte stream into whole JPEGs (FFD8 … FFD9). Keeps the unfinished tail between calls. */
export class JpegSplitter {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): Uint8Array[] {
    const b = new Uint8Array(this.buf.length + chunk.length)
    b.set(this.buf)
    b.set(chunk, this.buf.length)
    const out: Uint8Array[] = []
    let pos = 0
    for (;;) {
      const start = find(b, 0xd8, pos)
      if (start < 0) {
        pos = Math.max(pos, b.length - 1) // keep a possible half marker
        break
      }
      const end = find(b, 0xd9, start + 2)
      if (end < 0) {
        pos = start
        break
      }
      out.push(b.slice(start, end + 2))
      pos = end + 2
    }
    this.buf = b.slice(pos)
    return out
  }
}

function find(b: Uint8Array, second: number, from: number): number {
  for (let i = from; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === second) return i
  return -1
}

export interface GlassesStream {
  stream: MediaStream
  stop: () => void
}

/**
 * Resolves once the first frame is drawn (rejects if the edge can't reach the Pi). Afterwards a
 * dropped connection retries every second; the last frame stays up meanwhile.
 */
export function openGlasses(fps = 15, url = GLASSES_URL): Promise<GlassesStream> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(fps)
  let ac: AbortController | null = null
  let stopped = false
  let decoding = false
  let pending: Uint8Array | null = null

  const stop = () => {
    stopped = true
    ac?.abort()
    stream.getTracks().forEach((t) => t.stop())
  }

  return new Promise((resolve, reject) => {
    let first = true
    setTimeout(() => {
      if (first && !stopped) {
        stop()
        reject(new Error('Glasses camera: no picture in 8 s. Is the Pi plugged in? (hardware/start.sh checks it)'))
      }
    }, 8000)
    const draw = async (jpeg: Uint8Array) => {
      // newest frame wins: if a decode is still running, keep only the latest one waiting
      if (decoding) {
        pending = jpeg
        return
      }
      decoding = true
      try {
        const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width
          canvas.height = bmp.height
        }
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
        if (first) {
          first = false
          resolve({ stream, stop })
        }
      } catch {
        /* a broken frame: skip it */
      } finally {
        decoding = false
        const next = pending
        pending = null
        if (next && !stopped) void draw(next)
      }
    }

    const connect = async () => {
      while (!stopped) {
        ac = new AbortController()
        try {
          const r = await fetch(url, { signal: ac.signal, cache: 'no-store' })
          if (!r.ok || !r.body) {
            const msg = r.ok ? 'no body' : (await r.json().catch(() => null))?.detail ?? `HTTP ${r.status}`
            throw new Error(msg)
          }
          const split = new JpegSplitter()
          const reader = r.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done || stopped) break
            const frames = split.push(value)
            if (frames.length) void draw(frames[frames.length - 1])
          }
        } catch (e) {
          if (stopped) return
          if (first) {
            stop()
            reject(new Error(`Glasses camera: ${(e as Error).message}`))
            return
          }
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 1000))
      }
    }
    void connect()
  })
}

// ---------------- glasses mic ----------------
// The Brio 100's mic on the Pi, passed through by the edge app: raw 16 kHz mono s16le PCM.
// An AudioWorklet plays it into a MediaStreamAudioDestinationNode, so it records like any mic track.

export const GLASSES_MIC_URL = '/api/stream/glasses.pcm'
export const GLASSES_MIC_RATE = 16000

/** Little-endian 16-bit samples → floats in [-1, 1). Keeps an odd trailing byte for the next chunk. */
export class PcmDecoder {
  private odd: number | null = null

  push(chunk: Uint8Array): Float32Array {
    let bytes = chunk
    if (this.odd !== null) {
      bytes = new Uint8Array(chunk.length + 1)
      bytes[0] = this.odd
      bytes.set(chunk, 1)
      this.odd = null
    }
    const n = bytes.length >> 1
    if (bytes.length & 1) this.odd = bytes[bytes.length - 1]
    const out = new Float32Array(n)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768
    return out
  }
}

// Plays queued samples; starts after ~100 ms is buffered, and drops the oldest audio past ~400 ms
// so a network hiccup never leaves the sound running behind the picture.
const WORKLET = `
class GlassesMic extends AudioWorkletProcessor {
  constructor() {
    super()
    this.q = []; this.off = 0; this.size = 0; this.started = false
    this.port.onmessage = (e) => {
      this.q.push(e.data); this.size += e.data.length
      while (this.size - this.off > ${GLASSES_MIC_RATE * 0.4} && this.q.length > 1) { this.size -= this.q[0].length; this.q.shift(); this.off = 0 }
    }
  }
  process(_in, outs) {
    const out = outs[0][0]
    if (!this.started) { if (this.size - this.off < ${GLASSES_MIC_RATE * 0.1}) return true; this.started = true }
    let i = 0
    while (i < out.length && this.q.length) {
      const b = this.q[0], n = Math.min(out.length - i, b.length - this.off)
      out.set(b.subarray(this.off, this.off + n), i); i += n; this.off += n
      if (this.off >= b.length) { this.size -= b.length; this.q.shift(); this.off = 0 }
    }
    if (i < out.length) this.started = false // ran dry: wait for a little buffer again
    return true
  }
}
registerProcessor('glasses-mic', GlassesMic)
`

/** Resolves once the first audio arrives (rejects if the edge can't reach the Pi). Retries every second after a drop. */
export async function openGlassesMic(url = GLASSES_MIC_URL): Promise<GlassesStream> {
  const ctx = new AudioContext({ sampleRate: GLASSES_MIC_RATE })
  const mod = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(mod)
  } finally {
    URL.revokeObjectURL(mod)
  }
  const node = new AudioWorkletNode(ctx, 'glasses-mic', { numberOfInputs: 0, outputChannelCount: [1] })
  const dest = ctx.createMediaStreamDestination()
  node.connect(dest)
  void ctx.resume()
  let ac: AbortController | null = null
  let stopped = false
  const stop = () => {
    stopped = true
    ac?.abort()
    dest.stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  return new Promise((resolve, reject) => {
    let first = true
    setTimeout(() => {
      if (first && !stopped) {
        stop()
        reject(new Error('Glasses mic: no sound in 8 s. Is the Pi plugged in? (hardware/start.sh checks it)'))
      }
    }, 8000)
    const connect = async () => {
      while (!stopped) {
        ac = new AbortController()
        try {
          const r = await fetch(url, { signal: ac.signal, cache: 'no-store' })
          if (!r.ok || !r.body) {
            const msg = r.ok ? 'no body' : (await r.json().catch(() => null))?.detail ?? `HTTP ${r.status}`
            throw new Error(msg)
          }
          const dec = new PcmDecoder()
          const reader = r.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done || stopped) break
            const pcm = dec.push(value)
            if (!pcm.length) continue
            node.port.postMessage(pcm, [pcm.buffer])
            if (first) {
              first = false
              resolve({ stream: dest.stream, stop })
            }
          }
        } catch (e) {
          if (stopped) return
          if (first) {
            stop()
            reject(new Error(`Glasses mic: ${(e as Error).message}`))
            return
          }
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 1000))
      }
    }
    void connect()
  })
}
