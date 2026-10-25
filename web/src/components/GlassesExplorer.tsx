import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react'
import { PARTS, VIEWS, type Finish, type GlassesView, type Hotspot, type Part, type PartId } from '../lib/glassesHotspots'
import { BRAND } from './Brand'

/* Interactive smart-glasses explorer: ordinary → smart reveal, proximity beacons, loupe + leader line + card. */

const NEAR = 160 // px: beacons start reacting
const OPEN = 64 // px: nearest beacon expands
const CLOSE = 120 // px: hysteresis before it collapses again
const ZOOM = 2.5

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
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(50)
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

  // rAF loop: proximity glow + magnetic ring, eased with lerp
  useEffect(() => {
    if (!view || !size.w) return
    let raf = 0
    const tick = () => {
      const pt = pointer.current
      let nearest: { id: PartId; d: number } | null = null
      for (const s of spots) {
        const cx = s.x * size.w
        const cy = s.y * size.h
        let tp = 0
        let tx = 0
        let ty = 0
        if (pt) {
          const dx = pt.x - cx
          const dy = pt.y - cy
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
          const curD = pt ? Math.hypot(pt.x - (spots.find((s) => s.part === a.id)?.x ?? 0) * size.w, pt.y - (spots.find((s) => s.part === a.id)?.y ?? 0) * size.h) : Infinity
          if (curD > CLOSE) setActive(null)
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

  // compare slider drag
  const dragging = useRef(false)
  const setSplitFrom = (clientX: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }

  const zoom = view && view.width < 1000 ? 1.8 : ZOOM
  const geo = useMemo(() => {
    if (!activeSpot || !size.w) return null
    const W = size.w
    const H = size.h
    const cx = activeSpot.x * W
    const cy = activeSpot.y * H
    const D = Math.round(Math.max(narrow ? 96 : 120, Math.min(200, W * 0.17, H - 16)))
    // loupe stays fully inside the stage; it still magnifies the true part position
    const pad = 6
    const lx = Math.max(D / 2 + pad, Math.min(W - D / 2 - pad, cx))
    const ly = Math.max(D / 2 + pad, Math.min(H - D / 2 - pad, cy))
    const shifted = Math.hypot(lx - cx, ly - cy) > 4
    const cardW = Math.min(270, W * 0.34)
    const m = 12
    const xs = [m, (W - cardW) / 2, W - cardW - m]
    const ys = [m, (H - cardH) / 2, H - cardH - m]
    const cands: [number, number][] = []
    for (const x of xs) for (const y of ys) if (!(x === xs[1] && y === ys[1])) cands.push([x, y])
    const others = spots.filter((s) => s.part !== activeSpot.part)
    let best = cands[0]
    let bestScore = Infinity
    for (const [x, y] of cands) {
      let score = 0
      for (const o of others) {
        const ox = o.x * W
        const oy = o.y * H
        if (ox > x - 16 && ox < x + cardW + 16 && oy > y - 16 && oy < y + cardH + 16) score += 10
      }
      // loupe overlap (rect intersection of the loupe's box, normalised)
      const ix = Math.max(0, Math.min(x + cardW, lx + D / 2) - Math.max(x, lx - D / 2))
      const iy = Math.max(0, Math.min(y + cardH, ly + D / 2) - Math.max(y, ly - D / 2))
      score += ((ix * iy) / (D * D)) * 25
      // the part itself must stay visible
      if (cx > x - 8 && cx < x + cardW + 8 && cy > y - 8 && cy < y + cardH + 8) score += 30
      score += Math.hypot(x + cardW / 2 - lx, y + cardH / 2 - ly) / W
      if (score < bestScore) {
        bestScore = score
        best = [x, y]
      }
    }
    const [left, top] = best
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
    const tether = shifted ? `M${cx.toFixed(1)},${cy.toFixed(1)} L${(lx + Math.cos(tang) * (D / 2 + 3)).toFixed(1)},${(ly + Math.sin(tang) * (D / 2 + 3)).toFixed(1)}` : null
    return { cx, cy, lx, ly, D, cardW, left, top, path, ax, ay, right: left + cardW / 2 > lx, tether }
  }, [activeSpot, spots, size.w, size.h, narrow, cardH])

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
          backgroundPosition: `${geo.D / 2 - geo.cx * zoom}px ${geo.D / 2 - geo.cy * zoom}px`,
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

  const showSmartClip =
    compare ? `inset(0 0 0 ${split}%)` : undefined
  const caption =
    phase === 'plain' ? 'They look like ordinary glasses.' : phase === 'reveal' ? 'Until you look closer.' : null
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
              <button
                type="button"
                className={`gx-chip ${compare ? 'is-on' : ''}`}
                aria-pressed={compare}
                onClick={() => {
                  setCompare((c) => !c)
                  setSplit(50)
                  setActive(null)
                  setPhase('smart')
                }}
              >
                Compare with ordinary
              </button>
              <button type="button" className="gx-chip" onClick={() => { setCompare(false); setActive(null); playReveal() }}>
                Show the tech
              </button>
            </div>
          </div>

          <div
            ref={stageRef}
            className={`gx-stage finish-${finish} ${active ? 'has-active' : ''} ${compare ? 'is-compare' : ''}`}
            style={{ aspectRatio: `${view.width} / ${view.height}`, maxWidth: view.width < 1000 ? Math.round(view.width * 1.25) : undefined } as CSSProperties}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
          >
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
                        clipPath: showSmartClip,
                        '--ox': `${(revealOrigin?.x ?? 0.5) * 100}%`,
                        '--oy': `${(revealOrigin?.y ?? 0.5) * 100}%`,
                      } as CSSProperties
                    }
                  />
                </div>
              ))}
              <div className="gx-scan" aria-hidden="true" />
            </div>

            {caption && (
              <p key={caption} className="gx-caption" aria-live="polite">
                {caption}
              </p>
            )}

            {!compare && (phase === 'smart' || phase === 'idle') && (
              <>
                {loupe}
                {geo && !narrow && (
                  <svg className="gx-lines" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
                    <path key={`${active!.id}-l`} className="gx-leader" d={geo.path} pathLength={1} />
                    {geo.tether && <path key={`${active!.id}-t`} className="gx-leader gx-tether" d={geo.tether} pathLength={1} />}
                    {geo.tether && <circle key={`${active!.id}-p`} className="gx-part-dot" cx={geo.cx} cy={geo.cy} r={5} />}
                    <circle key={`${active!.id}-d`} className="gx-leader-dot" cx={geo.ax} cy={geo.ay} r={3.5} />
                  </svg>
                )}
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
                {!narrow && card}
              </>
            )}

            {compare && (
              <div
                className="gx-split"
                style={{ left: `${split}%` }}
                role="slider"
                tabIndex={0}
                aria-label="Compare ordinary and smart glasses"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                aria-valuetext={`${Math.round(split)}% ordinary`}
                onPointerDown={(e) => {
                  dragging.current = true
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => dragging.current && setSplitFrom(e.clientX)}
                onPointerUp={() => (dragging.current = false)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setSplit((v) => Math.max(0, v - 5))
                  if (e.key === 'ArrowRight') setSplit((v) => Math.min(100, v + 5))
                }}
              >
                <span className="gx-split-knob" aria-hidden="true">
                  ‹ ›
                </span>
                <span className="gx-split-l" aria-hidden="true">Ordinary</span>
                <span className="gx-split-r" aria-hidden="true">{BRAND}</span>
              </div>
            )}
          </div>

          {narrow && !compare && card}
          {narrow && !active && !compare && <p className="gx-hint">Tap a dot to see what it does.</p>}

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
                      setCompare(false)
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
