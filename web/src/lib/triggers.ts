// Snapshot triggers (PLAN.md §2). Pure logic so it can be unit-tested without a camera.
//   pause      – hands in the work area stay still for pause_s after moving
//   left_area  – hands were in the work area, then none are for left_area_s
//   timeout    – no check for timeout_s
// Voice ("done", "is this correct?") triggers come from push-to-talk, not from here.
// While a check is in flight (busy) nothing fires and nothing is consumed.

export type Pt = { x: number; y: number }
export type Area = { x: number; y: number; w: number; h: number } // normalized 0–1
export type Trigger = 'pause' | 'left_area' | 'timeout'

export interface TriggerConfig {
  pause_s: number
  still_move: number
  rearm_move: number
  left_area_s: number
  timeout_s: number
}

export interface TriggerState {
  trigger: Trigger | null
  motion: number
  handsInArea: boolean
  hands: number
  phase: 'no_hands' | 'moving' | 'still' | 'busy'
}

const centroid = (hand: Pt[]): Pt => {
  let x = 0
  let y = 0
  for (const p of hand) {
    x += p.x
    y += p.y
  }
  return { x: x / hand.length, y: y / hand.length }
}

export const inArea = (p: Pt, a: Area) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h

export class TriggerEngine {
  private prev: Pt[][] = []
  private armedPause = false
  private armedLeave = false
  private stillSince: number | null = null
  private leftSince: number | null = null
  private lastCheck: number
  private cfg: TriggerConfig
  busy = false

  constructor(cfg: TriggerConfig, now: number) {
    this.cfg = cfg
    this.lastCheck = now
  }

  /** Call whenever any check runs (including voice/button), so the timeout restarts. */
  markChecked(now: number) {
    this.lastCheck = now
    this.armedPause = false
    this.stillSince = null
  }

  update(hands: Pt[][], now: number, area: Area): TriggerState {
    const motion = this.motion(hands)
    this.prev = hands
    const handsInArea = hands.some((h) => inArea(centroid(h), area))

    if (motion > this.cfg.rearm_move) {
      this.armedPause = true
      this.stillSince = null
    }
    if (handsInArea) {
      this.leftSince = null
      if (motion > this.cfg.rearm_move) this.armedLeave = true
    }

    const base = { motion, handsInArea, hands: hands.length }
    if (this.busy) return { ...base, trigger: null, phase: 'busy' }

    // timeout
    if (now - this.lastCheck >= this.cfg.timeout_s) {
      return { ...base, trigger: this.fire('timeout', now), phase: hands.length ? 'still' : 'no_hands' }
    }

    // hands left the work area
    if (!handsInArea && this.armedLeave) {
      this.leftSince ??= now
      if (now - this.leftSince >= this.cfg.left_area_s) {
        return { ...base, trigger: this.fire('left_area', now), phase: 'no_hands' }
      }
    }

    // hands paused inside the work area
    if (handsInArea && motion < this.cfg.still_move) {
      this.stillSince ??= now
      if (this.armedPause && now - this.stillSince >= this.cfg.pause_s) {
        return { ...base, trigger: this.fire('pause', now), phase: 'still' }
      }
      return { ...base, trigger: null, phase: 'still' }
    }
    if (motion >= this.cfg.still_move) this.stillSince = null
    return { ...base, trigger: null, phase: hands.length ? 'moving' : 'no_hands' }
  }

  private fire(t: Trigger, now: number): Trigger {
    this.markChecked(now)
    this.armedLeave = false
    this.leftSince = null
    return t
  }

  /** Mean landmark displacement per frame (normalized). A change in hand count counts as big motion. */
  private motion(hands: Pt[][]): number {
    if (hands.length !== this.prev.length) return hands.length || this.prev.length ? 1 : 0
    let sum = 0
    let n = 0
    hands.forEach((h, i) => {
      const p = this.prev[i]
      if (!p || p.length !== h.length) {
        sum += 1
        n += 1
        return
      }
      for (let k = 0; k < h.length; k++) {
        sum += Math.hypot(h[k].x - p[k].x, h[k].y - p[k].y)
        n += 1
      }
    })
    return n ? sum / n : 0
  }
}
