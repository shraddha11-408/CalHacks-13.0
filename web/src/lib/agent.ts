// A conversation with the coach: Cartesia Managed Agent over one WebSocket, straight from this screen.
// Mic → 24 kHz 16-bit PCM in 20 ms chunks → `audio_input`; `audio_output` → scheduled playback;
// `audio_output_clear` (the worker talked over the agent) → stop playback at once.
// Client tools arrive as `client_tool_call`; the page runs them (edge app + SpacetimeDB) and answers.
// Docs: docs.cartesia.ai/line/integrations/websocket-api, /agents/client-tools.

import { getMedia } from './media'

const RATE = 24000
const CHUNK = RATE / 50 // 20 ms

export type AgentState = 'connecting' | 'live' | 'ended' | 'error'

export interface AgentTurn {
  turn: number
  role: 'user' | 'assistant'
  text: string
  interrupted: boolean
  /** assistant only: from the end of the worker's turn to the agent starting to talk (Cartesia's clock) */
  responseMs: number
}

export interface ToolRun {
  toolCallId: string
  name: string
  params: Record<string, unknown>
  result: string
  ok: boolean
  ms: number
}

export interface AgentHandlers {
  onState: (s: AgentState, detail?: string) => void
  onReady: (callId: string, agentVersionId: string) => void
  onTurn: (t: AgentTurn) => void
  /** live text of the turn being spoken ('' when it ends) */
  onLive: (role: 'user' | 'assistant' | null, text: string) => void
  onSpeaking: (speaking: boolean) => void
  runTool: (name: string, params: Record<string, unknown>) => Promise<{ result: string; ok: boolean }>
  onTool: (t: ToolRun) => void
  /** true while the page itself is talking (send silence so the agent doesn't hear the app) */
  muteInput: () => boolean
}

// AudioWorklet: hands raw mic samples to the main thread (no ScriptProcessor, no main-thread audio work).
const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
}
registerProcessor('tap', Tap)`

const toB64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export class AgentCall {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private pending = new Float32Array(0)
  private ready = false
  private playHead = 0
  private sources = new Set<AudioBufferSourceNode>()
  private speaking = false
  private speakTimer: number | undefined
  private userEnd = new Map<number, number>() // user turn → end_time (s)
  private lastUserEnd: number | null = null
  private live: { role: 'user' | 'assistant' | null; text: string } = { role: null, text: '' }
  private closedByUs = false
  private h: AgentHandlers
  callId = ''

  constructor(h: AgentHandlers) {
    this.h = h
  }

  async start(url: string, token: string) {
    this.h.onState('connecting')
    this.ctx = new AudioContext({ sampleRate: RATE })
    this.stream = await getMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    const mod = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(mod)
    URL.revokeObjectURL(mod)
    this.node = new AudioWorkletNode(this.ctx, 'tap')
    this.node.port.onmessage = (e) => this.onMic(e.data as Float32Array)
    this.ctx.createMediaStreamSource(this.stream).connect(this.node)
    // browsers can't set WebSocket headers: the short-lived agent token goes in the query
    const ws = new WebSocket(`${url}&access_token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session_create', audio: { input_format: `pcm_${RATE}`, output_delivery: 'as_available', continuous_input: true } }))
    ws.onmessage = (m) => void this.onEvent(JSON.parse(m.data as string))
    ws.onerror = () => this.h.onState('error', 'connection failed')
    ws.onclose = (e) => {
      this.teardown()
      this.h.onState(e.code === 1000 || this.closedByUs ? 'ended' : 'error', e.reason || `closed (${e.code})`)
    }
  }

  stop(reason = 'worker') {
    this.closedByUs = true
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, reason.slice(0, 100))
    this.teardown()
  }

  private teardown() {
    this.ready = false
    this.clearPlayback()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close()
    this.node = null
    this.stream = null
    this.ctx = null
  }

  // ---- mic → agent ----
  private onMic(samples: Float32Array) {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending)
    merged.set(samples, this.pending.length)
    let off = 0
    const mute = this.h.muteInput()
    while (merged.length - off >= CHUNK) {
      const pcm = new Int16Array(CHUNK)
      if (!mute) for (let i = 0; i < CHUNK; i++) pcm[i] = Math.max(-1, Math.min(1, merged[off + i])) * 0x7fff
      this.ws.send(JSON.stringify({ type: 'audio_input', audio: toB64(new Uint8Array(pcm.buffer)) }))
      off += CHUNK
    }
    this.pending = merged.slice(off)
  }

  // ---- agent → speaker ----
  private play(b64: string) {
    const ctx = this.ctx
    if (!ctx) return
    const bin = atob(b64)
    const pcm = new Int16Array(bin.length >> 1)
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16
    if (!pcm.length) return
    const buf = ctx.createBuffer(1, pcm.length, RATE)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    this.playHead = Math.max(this.playHead, ctx.currentTime + 0.04)
    src.start(this.playHead)
    this.playHead += buf.duration
    this.sources.add(src)
    src.onended = () => {
      this.sources.delete(src)
      this.updateSpeaking()
    }
    this.updateSpeaking()
  }

  private clearPlayback() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* not started */
      }
    }
    this.sources.clear()
    this.playHead = 0
    this.updateSpeaking()
  }

  private updateSpeaking() {
    const now = this.sources.size > 0
    window.clearTimeout(this.speakTimer)
    if (now && !this.speaking) {
      this.speaking = true
      this.h.onSpeaking(true)
    } else if (!now && this.speaking) {
      // tiny gaps between chunks are not the end of speech
      this.speakTimer = window.setTimeout(() => {
        this.speaking = false
        this.h.onSpeaking(false)
      }, 250)
    }
  }

  get agentSpeaking() {
    return this.speaking
  }

  // ---- events ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async onEvent(ev: any) {
    switch (ev.type) {
      case 'session_ready':
        this.ready = true
        this.callId = ev.call_id
        this.h.onReady(ev.call_id, ev.agent_version_id ?? '')
        this.h.onState('live')
        break
      case 'audio_output':
        this.play(ev.audio)
        break
      case 'audio_output_clear':
        this.clearPlayback() // barge-in: the worker is talking
        break
      case 'turn_started':
        this.live = { role: ev.role, text: '' }
        this.h.onLive(ev.role, '')
        break
      case 'turn_output_text_delta':
        if (this.live.role !== 'assistant') this.live = { role: 'assistant', text: '' }
        this.live.text += ev.text ?? ''
        this.h.onLive('assistant', this.live.text)
        break
      case 'turn_ended': {
        this.live = { role: null, text: '' }
        this.h.onLive(null, '')
        let responseMs = 0
        if (ev.role === 'user') {
          this.userEnd.set(ev.turn, ev.end_time)
          this.lastUserEnd = ev.end_time
        } else if (this.lastUserEnd !== null && typeof ev.start_time === 'number' && ev.text) {
          responseMs = Math.max(0, Math.round((ev.start_time - this.lastUserEnd) * 1000))
          this.lastUserEnd = null // one measured response per worker turn
        }
        if (ev.text || ev.role === 'user') this.h.onTurn({ turn: ev.turn, role: ev.role, text: ev.text ?? '', interrupted: !!ev.interrupted, responseMs })
        break
      }
      case 'client_tool_call': {
        const t0 = performance.now()
        let r: { result: string; ok: boolean }
        try {
          r = await this.h.runTool(ev.tool_name, ev.parameters ?? {})
        } catch (e) {
          r = { result: `The tool failed: ${(e as Error).message}`.slice(0, 300), ok: false }
        }
        if (ev.expects_response && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'client_tool_result', tool_call_id: ev.tool_call_id, result: r.result.slice(0, 16000), is_error: !r.ok }))
        }
        this.h.onTool({ toolCallId: ev.tool_call_id, name: ev.tool_name, params: ev.parameters ?? {}, result: r.result, ok: r.ok, ms: Math.round(performance.now() - t0) })
        break
      }
      case 'error':
        if (ev.fatal) this.h.onState('error', ev.message || ev.code)
        break
    }
  }
}
