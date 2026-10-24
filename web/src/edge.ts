import { useEffect, useRef, useState } from 'react'
import type { HealthState } from './types'

export interface EdgeHealth {
  state: HealthState
  devices?: Record<string, string>
  keys_present?: Record<string, boolean>
}

/** Polls the real edge app (FastAPI :8000 via the /api proxy). */
export function useEdgeHealth(intervalMs = 5000): EdgeHealth {
  const [h, setH] = useState<EdgeHealth>({ state: 'off' })
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch('/api/health')
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        if (alive) setH({ state: 'ok', devices: j.devices, keys_present: j.keys_present })
      } catch {
        if (alive) setH({ state: 'down' })
      }
    }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [intervalMs])
  return h
}

export interface EdgeEvent {
  type: string
  ts: number
  [k: string]: unknown
}

/** Live events from the edge pipeline over WebSocket (/api/ws/events). Reconnects on drop. */
export function useEdgeEvents(onEvent: (e: EdgeEvent) => void): boolean {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })
  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: number | undefined
    let alive = true
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/ws/events`)
      ws.onopen = () => setConnected(true)
      ws.onmessage = (m) => {
        try {
          handler.current(JSON.parse(m.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (alive) retry = window.setTimeout(open, 1500)
      }
    }
    open()
    return () => {
      alive = false
      window.clearTimeout(retry)
      ws?.close()
    }
  }, [])
  return connected
}

export interface PipelineStats {
  camera: string
  camera_error: string | null
  fps: number
  gate_state: 'moving' | 'settling' | 'settled'
  markers: number[]
  checks: number
  gate_rectify_ms_p50: number | null
  gate_rectify_ms_p99: number | null
}

/** Pipeline stats (/api/stats), polled. null while the camera isn't running. */
export function usePipelineStats(intervalMs = 1000): PipelineStats | null {
  const [s, setS] = useState<PipelineStats | null>(null)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch('/api/stats')
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        if (alive) setS(j)
      } catch {
        if (alive) setS(null)
      }
    }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [intervalMs])
  return s
}
