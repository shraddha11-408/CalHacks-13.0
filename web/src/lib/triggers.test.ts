// node --test src/lib/*.test.ts   (Node 24 strips types natively)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TriggerEngine, type Area, type Pt } from './triggers.ts'

const CFG = { pause_s: 0.8, still_move: 0.006, rearm_move: 0.015, left_area_s: 0.5, timeout_s: 8 }
const AREA: Area = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }
const FPS = 15
const hand = (cx: number, cy: number): Pt[] => Array.from({ length: 21 }, (_, i) => ({ x: cx + (i % 5) * 0.01, y: cy + Math.floor(i / 5) * 0.01 }))

function run(e: TriggerEngine, frames: Pt[][][], t0: number) {
  const fired: { t: number; trig: string }[] = []
  frames.forEach((h, i) => {
    const t = t0 + i / FPS
    const s = e.update(h, t, AREA)
    if (s.trigger) fired.push({ t, trig: s.trigger })
  })
  return fired
}
const moving = (n: number) => Array.from({ length: n }, (_, i) => [hand(0.4 + (i % 2) * 0.05, 0.5)])
const still = (n: number) => Array.from({ length: n }, () => [hand(0.45, 0.5)])

test('pause fires once ~0.8 s after hands stop moving', () => {
  const e = new TriggerEngine(CFG, 0)
  const f = run(e, [...moving(10), ...still(30)], 0)
  assert.equal(f.length, 1)
  assert.equal(f[0].trig, 'pause')
  const stillStart = 10 / FPS
  assert.ok(f[0].t - stillStart >= 0.8 - 1e-9 && f[0].t - stillStart <= 0.8 + 2 / FPS)
})

test('hands appearing count as movement: one pause, then no re-fire while still', () => {
  const e = new TriggerEngine(CFG, 0)
  assert.equal(run(e, still(60), 0).length, 1)
  assert.equal(run(e, still(60), 60 / FPS).length, 0)
})

test('hands leaving the work area fires left_area', () => {
  const e = new TriggerEngine(CFG, 0)
  const away = Array.from({ length: 15 }, () => [hand(0.92, 0.95)])
  const f = run(e, [...moving(8), ...away], 0)
  assert.deepEqual(f.map((x) => x.trig), ['left_area'])
})

test('timeout fires after 8 s with no check', () => {
  const e = new TriggerEngine(CFG, 0)
  const f = run(e, Array.from({ length: 8 * FPS + 2 }, () => [] as Pt[][]), 0)
  assert.deepEqual(f.map((x) => x.trig), ['timeout'])
})

test('busy blocks triggers and keeps the arm', () => {
  const e = new TriggerEngine(CFG, 0)
  run(e, moving(10), 0)
  e.busy = true
  assert.equal(run(e, still(30), 10 / FPS).length, 0)
  e.busy = false // answer is back: the arm is kept, the 0.8 s stillness timer restarts
  const f = run(e, still(15), 40 / FPS)
  assert.equal(f[0]?.trig, 'pause')
})

test('markChecked (voice/button) restarts the timeout', () => {
  const e = new TriggerEngine(CFG, 0)
  e.markChecked(7)
  const f = run(e, Array.from({ length: 30 }, () => [] as Pt[][]), 7.5)
  assert.equal(f.length, 0)
})
