import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react'
import { PARTS, VIEWS, type Finish, type GlassesView, type Hotspot, type Part, type PartId } from '../lib/glassesHotspots'
import { BRAND } from './Brand'

/* Interactive smart-glasses explorer: ordinary → smart reveal, proximity beacons, loupe + leader line + card. */

const NEAR = 160 // px: beacons start reacting
const OPEN = 64 // px: nearest beacon expands
const CLOSE = 120 // px: hysteresis before it collapses again
const ZOOM = 2.5
const PERSP = 1200 // px
const TILT_Y = 7 // deg, pointer-driven rotateY
const TILT_X = 3 // deg, pointer-driven rotateX
const SWAY = 4 // deg, idle sway amplitude
const SWAY_MS = 8000 // idle sway period
const ENTER_Y = -10 // deg, scroll-linked rotateY as the section enters

type LoupeLayout = { cx: number; cy: number; lx: number; ly: number; path: string; tether: string; ax: number; ay: number; shifted: boolean }
type Tilt = { rx: number; ry: number; vx: number; vy: number }

/* Project a stage-space point through perspective(P) rotateY(ry) rotateX(rx), origin = stage centre (same as the CSS). */
function project(x: number, y: number, w: number, h: number, t: { rx: number; ry: number }) {
  const ox = w / 2
  const oy = h / 2
  const px = x - ox
  const py = y - oy
  const a = (t.rx * Math.PI) / 180
  const b = (t.ry * Math.PI) / 180
  const y1 = py * Math.cos(a)
  const z1 = py * Math.sin(a)
  const x2 = px * Math.cos(b) + z1 * Math.sin(b)
  const z2 = -px * Math.sin(b) + z1 * Math.cos(b)
  const k = 1 / (1 - z2 / PERSP)
  return { x: ox + x2 * k, y: oy + y1 * k }
}
const tiltCss = (t: { rx: number; ry: number }) => `perspective(${PERSP}px) rotateY(${t.ry.toFixed(3)}deg) rotateX(${t.rx.toFixed(3)}deg)`

type Active = { id: PartId; pinned: boolean } | null
type Phase = 'idle' | 'plain' | 'reveal' | 'smart'

const FINISHES: { id: Finish; label: string }[] = [
  { id: 'ivory', label: 'Ivory' },
  { id: 'black', label: 'Matte black' },
]

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

function partFromHash(): PartId | null {
  const h = typeof window !== 'undefined' ? window.location.hash : ''
  const m = /^#look-closer\?part=([a-z-]+)/.exec(h)
  return (m?.[1] as PartId) ?? null
}

export function GlassesExplorer() {
  const views = VIEWS
  const parts = PARTS
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const narrow = useMedia('(max-width: 640px)')
  const uid = useId()
  const cardId = `gx-card-${uid}`

  const [finish, setFinish] = useState<Finish>('ivory')
  const [viewIdx, setViewIdx] = useState(0)
  const [active, setActiveState] = useState<Active>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cardH, setCardH] = useState(180)
  const cardRO = useRef<ResizeObserver | null>(null)
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    cardRO.current?.disconnect()
    if (!el) return
    const ro = new ResizeObserver(() => setCardH(Math.round(el.offsetHeight)))
    ro.observe(el)
    cardRO.current = ro
  }, [])

  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const beaconRefs = useRef(new Map<PartId, HTMLButtonElement>())
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const prox = useRef(new Map<PartId, { p: number; mx: number; my: number }>())
  const activeRef = useRef<Active>(null)
  const overCard = useRef(false)
  const timers = useRef<number[]>([])
  const tiltRef = useRef<HTMLDivElement>(null)
  const tilt = useRef<Tilt>({ rx: 0, ry: 0, vx: 0, vy: 0 })
  const loupeRef = useRef<HTMLDivElement | null>(null)
  const linesRef = useRef<SVGSVGElement | null>(null)
  const layoutRef = useRef<((cx: number, cy: number) => LoupeLayout) | null>(null)

  const view: GlassesView | undefined = views[viewIdx]
  const spots: Hotspot[] = view?.hotspots[finish] ?? []
  const activeSpot = active ? spots.find((s) => s.part === active.id) : undefined
  const activePart: Part | undefined = active ? parts[active.id] : undefined

  const setActive = useCallback((a: Active) => {
    const cur = activeRef.current
    if (cur?.id === a?.id && cur?.pinned === a?.pinned) return
    activeRef.current = a
    setActiveState(a)
  }, [])

  // stage size (no layout shift: aspect-ratio comes from the view's natural size)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view?.id])

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  const playReveal = useCallback(() => {
    clearTimers()
    if (reduced) return setPhase('smart')
    setPhase('plain')
    timers.current.push(window.setTimeout(() => setPhase('reveal'), 1300))
    timers.current.push(window.setTimeout(() => setPhase('smart'), 1300 + 1700))
  }, [reduced])

  // first time in view: ordinary → smart
  useEffect(() => {
    const el = rootRef.current
    if (!el || !view) return
    if (partFromHash()) return setPhase('smart')
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          io.disconnect()
          playReveal()
        }
      },
      { threshold: 0.45 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!view])

  // deep link: #look-closer?part=camera
  useEffect(() => {
    const id = partFromHash()
    if (!id || !views.length) return
    const vi = views.findIndex((v) => v.hotspots.ivory.some((s) => s.part === id))
    if (vi >= 0) setViewIdx(vi)
    setPhase('smart')
    setActive({ id, pinned: true })
    rootRef.current?.scrollIntoView({ block: 'start' })
  }, [views, setActive])

  // preload the other finish + other views after first paint
  useEffect(() => {
    if (!views.length) return
    const go = () =>
      views.forEach((v) =>
        (['ivory', 'black'] as Finish[]).forEach((f) => {
          const a = new Image()
          a.decoding = 'async'
          a.src = v.src[f].smart
          const b = new Image()
          b.decoding = 'async'
          b.src = v.src[f].plain
        }),
      )
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    const t = w.requestIdleCallback ? w.requestIdleCallback(go) : window.setTimeout(go, 1200)
    return () => {
      if (!w.requestIdleCallback) window.clearTimeout(t)
    }
  }, [views])

  // Esc closes
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeRef.current) setActive(null)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [setActive])

  // rAF loop: 3D tilt (pointer / idle sway / scroll entry, spring-eased) + proximity glow + magnetic ring.
  // Tilt state lives in a ref so it carries on smoothly across reveal, finish and view switches.
  useEffect(() => {
    if (!view || !size.w) return
    let raf = 0
    const W = size.w
    const H = size.h
    const tick = (now: number) => {
      const pt = pointer.current
      const t = tilt.current
      if (reduced) {
        t.rx = t.ry = t.vx = t.vy = 0
      } else {
        let tx: number
        let ty: number
        if (pt) {
          const nx = Math.max(-1, Math.min(1, (pt.x / W) * 2 - 1))
          const ny = Math.max(-1, Math.min(1, (pt.y / H) * 2 - 1))
          ty = nx * TILT_Y
          tx = -ny * TILT_X
        } else {
          ty = SWAY * Math.sin((now / SWAY_MS) * Math.PI * 2)
          tx = 1.2 * Math.sin((now / (SWAY_MS * 1.37)) * Math.PI * 2)
        }
        const st = stageRef.current
        if (st) {
          const vh = window.innerHeight || 1
          const top = st.getBoundingClientRect().top
          const prog = Math.max(0, Math.min(1, (vh - top) / (vh * 0.75)))
          const e = 1 - (1 - prog) * (1 - prog) * (1 - prog)
          ty += ENTER_Y * (1 - e)
        }
        // springy: a little overshoot, then settle
        t.vx = (t.vx + (tx - t.rx) * 0.06) * 0.8
        t.vy = (t.vy + (ty - t.ry) * 0.06) * 0.8
        t.rx += t.vx
        t.ry += t.vy
      }
      const tw = tiltRef.current
      if (tw) tw.style.transform = reduced ? '' : tiltCss(t)

      // proximity against the transformed (projected) beacon positions
      const pos = new Map<PartId, { x: number; y: number }>()
      for (const s of spots) pos.set(s.part, project(s.x * W, s.y * H, W, H, t))
      let nearest: { id: PartId; d: number } | null = null
      for (const s of spots) {
        const c = pos.get(s.part)!
        let tp = 0
        let tx = 0
        let ty = 0
        if (pt) {
          const dx = pt.x - c.x
          const dy = pt.y - c.y
          const d = Math.hypot(dx, dy)
          const lin = Math.max(0, 1 - d / NEAR)
          tp = lin * lin * (3 - 2 * lin) // smoothstep
          const pull = Math.min(14, d * 0.22) * tp
          tx = d ? (dx / d) * pull : 0
          ty = d ? (dy / d) * pull : 0
          if (!nearest || d < nearest.d) nearest = { id: s.part, d }
        }
        const cur = prox.current.get(s.part) ?? { p: 0, mx: 0, my: 0 }
        const k = reduced ? 1 : 0.16
        cur.p += (tp - cur.p) * k
        cur.mx += (tx - cur.mx) * k
        cur.my += (ty - cur.my) * k
        prox.current.set(s.part, cur)
        const el = beaconRefs.current.get(s.part)
        if (el) {
          el.style.setProperty('--p', cur.p.toFixed(3))
          el.style.setProperty('--mx', `${cur.mx.toFixed(2)}px`)
          el.style.setProperty('--my', `${cur.my.toFixed(2)}px`)
        }
      }
      const a = activeRef.current
      if (!a?.pinned && !overCard.current) {
        if (nearest && nearest.d < OPEN) setActive({ id: nearest.id, pinned: false })
        else if (a && (!nearest || nearest.id !== a.id || nearest.d > CLOSE)) {
          const ac = pos.get(a.id)
          const curD = pt && ac ? Math.hypot(pt.x - ac.x, pt.y - ac.y) : Infinity
          if (curD > CLOSE) setActive(null)
        }
      }

      // loupe + leader stay in screen space but follow the tilted part
      const lay = layoutRef.current
      const ac = a ? pos.get(a.id) : undefined
      if (lay && ac) {
        const g = lay(ac.x, ac.y)
        const lo = loupeRef.current
        if (lo) {
          const D = lo.offsetWidth
          lo.style.left = `${(g.lx - D / 2).toFixed(1)}px`
          lo.style.top = `${(g.ly - D / 2).toFixed(1)}px`
        }
        const sv = linesRef.current
        if (sv) {
          sv.querySelector('[data-k="leader"]')?.setAttribute('d', g.path)
          const te = sv.querySelector<SVGPathElement>('[data-k="tether"]')
          if (te) {
            te.setAttribute('d', g.tether || 'M0,0')
            te.style.visibility = g.shifted ? '' : 'hidden'
          }
          const pd = sv.querySelector<SVGCircleElement>('[data-k="pdot"]')
          if (pd) {
            pd.setAttribute('cx', g.cx.toFixed(1))
            pd.setAttribute('cy', g.cy.toFixed(1))
            pd.style.visibility = g.shifted ? '' : 'hidden'
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view, spots, size.w, size.h, reduced, setActive])

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const r = e.currentTarget.getBoundingClientRect()
    pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onLeave = () => {
    pointer.current = null
  }

  const zoom = view && view.width < 1000 ? 1.8 : ZOOM
  const geo = useMemo(() => {
    if (!activeSpot || !size.w) return null
    const W = size.w
    const H = size.h
    const t = reduced ? { rx: 0, ry: 0 } : tilt.current
    const fx = activeSpot.x * W // flat (image) position: what the loupe magnifies
    const fy = activeSpot.y * H
    const p0 = project(fx, fy, W, H, t) // where the tilted part is on screen right now
    const D = Math.round(Math.max(narrow ? 96 : 120, Math.min(200, W * 0.17, H - 16)))
    // loupe stays fully inside the stage; it still magnifies the true part position
    const pad = 6
    const place = (cx: number, cy: number) => ({
      lx: Math.max(D / 2 + pad, Math.min(W - D / 2 - pad, cx)),
      ly: Math.max(D / 2 + pad, Math.min(H - D / 2 - pad, cy)),
    })
    const { lx, ly } = place(p0.x, p0.y)
    const cardW = Math.min(270, W * 0.34)
    const m = 12
    const xs = [m, (W - cardW) / 2, W - cardW - m]
    const ys = [m, (H - cardH) / 2, H - cardH - m]
    const cands: [number, number][] = []
    for (const x of xs) for (const y of ys) if (!(x === xs[1] && y === ys[1])) cands.push([x, y])
    const others = spots.filter((s) => s.part !== activeSpot.part).map((o) => project(o.x * W, o.y * H, W, H, t))
    let best = cands[0]
    let bestScore = Infinity
    for (const [x, y] of cands) {
      let score = 0
      for (const o of others) {
        if (o.x > x - 16 && o.x < x + cardW + 16 && o.y > y - 16 && o.y < y + cardH + 16) score += 10
      }
      // loupe overlap (rect intersection of the loupe's box, normalised)
      const ix = Math.max(0, Math.min(x + cardW, lx + D / 2) - Math.max(x, lx - D / 2))
      const iy = Math.max(0, Math.min(y + cardH, ly + D / 2) - Math.max(y, ly - D / 2))
      score += ((ix * iy) / (D * D)) * 25
      // the part itself must stay visible (with room for the tilt to move it)
      if (p0.x > x - 20 && p0.x < x + cardW + 20 && p0.y > y - 14 && p0.y < y + cardH + 14) score += 30
      score += Math.hypot(x + cardW / 2 - lx, y + cardH / 2 - ly) / W
      if (score < bestScore) {
        bestScore = score
        best = [x, y]
      }
    }
    const [left, top] = best
    const layout = (cx: number, cy: number): LoupeLayout => {
      const { lx, ly } = place(cx, cy)
      const shifted = Math.hypot(lx - cx, ly - cy) > 4
      const ax = Math.max(left, Math.min(left + cardW, lx))
      const ay = Math.max(top + 24, Math.min(top + cardH - 24, ly))
      const ang = Math.atan2(ay - ly, ax - lx)
      const sx = lx + Math.cos(ang) * (D / 2 + 4)
      const sy = ly + Math.sin(ang) * (D / 2 + 4)
      const horiz = Math.abs(ax - sx) >= Math.abs(ay - sy)
      const mx = (sx + ax) / 2
      const my = (sy + ay) / 2
      const path = horiz
        ? `M${sx.toFixed(1)},${sy.toFixed(1)} C${mx.toFixed(1)},${sy.toFixed(1)} ${mx.toFixed(1)},${ay.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`
        : `M${sx.toFixed(1)},${sy.toFixed(1)} C${sx.toFixed(1)},${my.toFixed(1)} ${ax.toFixed(1)},${my.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`
      // short tether from the true part to a shifted loupe
      const tang = Math.atan2(cy - ly, cx - lx)
      const tether = shifted ? `M${cx.toFixed(1)},${cy.toFixed(1)} L${(lx + Math.cos(tang) * (D / 2 + 3)).toFixed(1)},${(ly + Math.sin(tang) * (D / 2 + 3)).toFixed(1)}` : ''
      return { cx, cy, lx, ly, path, tether, ax, ay, shifted }
    }
    return { ...layout(p0.x, p0.y), fx, fy, D, cardW, left, top, right: left + cardW / 2 > lx, layout }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpot, spots, size.w, size.h, narrow, cardH, reduced])
  useLayoutEffect(() => {
    layoutRef.current = geo?.layout ?? null
  }, [geo])

  if (!view) {
    return (
      <section className="gx" id="look-closer" aria-labelledby="gx-h">
        <div className="gx-head">
          <p className="eyebrow">The glasses</p>
          <h2 id="gx-h">Look closer.</h2>
          <p className="gx-lede">They look like everyday glasses. Every part has a job.</p>
        </div>
        <div className="gx-stage gx-stage--empty" aria-hidden="true" />
      </section>
    )
  }

  const order = (Object.keys(parts) as PartId[]).filter((id) => views.some((v) => v.hotspots[finish].some((s) => s.part === id)))
  const num = (id: PartId) => String(order.indexOf(id) + 1).padStart(2, '0')
  const smartSrc = view.src[finish].smart
  const loupe = activeSpot && geo && (
    <div
      key={`${active!.id}-${finish}-${view.id}`}
      ref={loupeRef}
      className="gx-loupe"
      aria-hidden="true"
      style={
        {
          width: geo.D,
          height: geo.D,
          left: geo.lx - geo.D / 2,
          top: geo.ly - geo.D / 2,
          backgroundImage: `url(${smartSrc})`,
          backgroundSize: `${size.w * zoom}px ${size.h * zoom}px`,
          backgroundPosition: `${geo.D / 2 - geo.fx * zoom}px ${geo.D / 2 - geo.fy * zoom}px`,
        } as CSSProperties
      }
    />
  )

  const card = activePart && active && (
    <div
      key={active.id}
      ref={cardRef}
      id={cardId}
      className={`gx-card ${narrow ? 'gx-card--sheet' : geo?.right ? 'from-left' : 'from-right'}`}
      role="region"
      aria-live="polite"
      aria-label={activePart.title}
      style={!narrow && geo ? { left: geo.left, top: geo.top, width: geo.cardW } : undefined}
      onPointerEnter={() => (overCard.current = true)}
      onPointerLeave={() => (overCard.current = false)}
    >
      <p className="gx-tag">
        {num(active.id)} · {activePart.title.toUpperCase()}
      </p>
      <h3>{activePart.title}</h3>
      <p className="gx-what">{activePart.what}</p>
      <p className="gx-why">{activePart.why}</p>
      {narrow && (
        <button type="button" className="gx-close" onClick={() => setActive(null)} aria-label="Close">
          ×
        </button>
      )}
    </div>
  )

  const caption =
    phase === 'plain' ? 'They look like ordinary glasses.' : phase === 'reveal' ? 'Until you look closer.' : null
  const showSpots = phase === 'smart' || phase === 'idle'
  const revealOrigin = spots.find((s) => s.part === 'camera') ?? spots[0]

  return (
    <section ref={rootRef} className={`gx phase-${phase}`} id="look-closer" aria-labelledby="gx-h">
      <div className="gx-head">
        <p className="eyebrow">The glasses</p>
        <h2 id="gx-h">Look closer.</h2>
        <p className="gx-lede">They look like everyday glasses. Every part has a job.</p>
      </div>

      <div className="gx-layout">
        <div className="gx-main">
          <div className="gx-controls">
            <div className="gx-seg" role="radiogroup" aria-label="Finish" style={{ '--i': FINISHES.findIndex((f) => f.id === finish) } as CSSProperties}>
              <span className="gx-seg-thumb" aria-hidden="true" />
              {FINISHES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={finish === f.id}
                  className={`gx-seg-btn ${finish === f.id ? 'is-on' : ''}`}
                  onClick={() => setFinish(f.id)}
                >
                  <span className={`gx-swatch gx-swatch--${f.id}`} aria-hidden="true" />
                  {f.label}
                </button>
              ))}
            </div>
            <div className="gx-tools">
              <button type="button" className="gx-chip" onClick={() => { setActive(null); playReveal() }}>
                Show the tech
              </button>
            </div>
          </div>

          <div
            ref={stageRef}
            className={`gx-stage finish-${finish} ${active ? 'has-active' : ''}`}
            style={{ aspectRatio: `${view.width} / ${view.height}`, maxWidth: view.width < 1000 ? Math.round(view.width * 1.25) : undefined } as CSSProperties}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
          >
            <div ref={tiltRef} className="gx-tilt">
              <div key={view.id} className="gx-layers">
                {FINISHES.map((f) => (
                  <div key={f.id} className={`gx-layer ${f.id === finish ? 'is-on' : ''}`} aria-hidden={f.id !== finish}>
                    <img className="gx-img gx-img--plain" src={view.src[f.id].plain} alt="" width={view.width} height={view.height} loading="lazy" decoding="async" draggable={false} />
                    <img
                      className="gx-img gx-img--smart"
                      src={view.src[f.id].smart}
                      alt={f.id === finish ? `${BRAND} smart glasses, ${f.label.toLowerCase()}, ${view.label.toLowerCase()} view` : ''}
                      width={view.width}
                      height={view.height}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      style={
                        {
                          '--ox': `${(revealOrigin?.x ?? 0.5) * 100}%`,
                          '--oy': `${(revealOrigin?.y ?? 0.5) * 100}%`,
                        } as CSSProperties
                      }
                    />
                  </div>
                ))}
                <div className="gx-scan" aria-hidden="true" />
              </div>
              {showSpots && (
              <div className="gx-beacons">
                {spots.map((s, i) => {
                  const p = parts[s.part]
                  if (!p) return null
                  const on = active?.id === s.part
                  return (
                    <button
                      key={s.part}
                      ref={(el) => {
                        if (el) beaconRefs.current.set(s.part, el)
                        else beaconRefs.current.delete(s.part)
                      }}
                      type="button"
                      className={`gx-beacon ${on ? 'is-on' : ''}`}
                      style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, '--d': `${i * 0.37}s` } as CSSProperties}
                      aria-label={`${num(s.part)} ${p.title}`}
                      aria-expanded={on}
                      aria-describedby={on ? cardId : undefined}
                      onClick={() => setActive(on && active?.pinned ? null : { id: s.part, pinned: true })}
                      onFocus={(e) => {
                        if (e.currentTarget.matches(':focus-visible')) setActive({ id: s.part, pinned: true })
                      }}
                    >
                      <span className="gx-beacon-halo" />
                      <span className="gx-beacon-ring" />
                      <span className="gx-beacon-core" />
                    </button>
                  )
                })}
              </div>
              )}
            </div>

            {caption && (
              <p key={caption} className="gx-caption" aria-live="polite">
                {caption}
              </p>
            )}

            {showSpots && (
              <>
                {loupe}
                {geo && !narrow && (
                  <svg ref={linesRef} className="gx-lines" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
                    <path key={`${active!.id}-l`} data-k="leader" className="gx-leader" d={geo.path} pathLength={1} />
                    <path key={`${active!.id}-t`} data-k="tether" className="gx-leader gx-tether" d={geo.tether || 'M0,0'} pathLength={1} style={{ visibility: geo.shifted ? undefined : 'hidden' }} />
                    <circle key={`${active!.id}-p`} data-k="pdot" className="gx-part-dot" cx={geo.cx} cy={geo.cy} r={5} style={{ visibility: geo.shifted ? undefined : 'hidden' }} />
                    <circle key={`${active!.id}-d`} className="gx-leader-dot" cx={geo.ax} cy={geo.ay} r={3.5} />
                  </svg>
                )}
                {!narrow && card}
              </>
            )}
          </div>

          {narrow && card}
          {narrow && !active && <p className="gx-hint">Tap a dot to see what it does.</p>}

          {views.length > 1 && (
            <div className="gx-views" role="radiogroup" aria-label="View">
              {views.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={i === viewIdx}
                  className={`gx-view ${i === viewIdx ? 'is-on' : ''}`}
                  onClick={() => {
                    setViewIdx(i)
                    setActive(null)
                  }}
                >
                  <img src={v.src[finish].smart} alt="" loading="lazy" decoding="async" width={v.width} height={v.height} />
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="gx-index" aria-label="Parts">
          <p className="gx-index-title">Parts</p>
          <ol>
            {order.map((id) => {
              const p = parts[id]
              const here = spots.some((s) => s.part === id)
              const on = active?.id === id
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`gx-index-btn ${on ? 'is-on' : ''} ${here ? '' : 'is-away'}`}
                    aria-pressed={on}
                    onPointerEnter={(e) => {
                      if (e.pointerType !== 'touch' && here && !activeRef.current?.pinned) setActive({ id, pinned: false })
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType !== 'touch' && activeRef.current?.id === id && !activeRef.current.pinned) setActive(null)
                    }}
                    onClick={() => {
                      if (!here) {
                        const vi = views.findIndex((v) => v.hotspots[finish].some((s) => s.part === id))
                        if (vi >= 0) setViewIdx(vi)
                      }
                      setPhase('smart')
                      setActive(on && active?.pinned ? null : { id, pinned: true })
                    }}
                  >
                    <span className="gx-index-n">{num(id)}</span>
                    <span className="gx-index-t">{p.title}</span>
                    {!here && <span className="gx-index-away">other side</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>
      </div>
    </section>
  )
}
