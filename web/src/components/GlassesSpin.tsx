import { useEffect, useRef } from 'react'
import '../styles/glasses.css'

// Scroll-linked smart glasses. Pure CSS 3D: a layered front frame (extruded by stacking),
// two temple arms as rotated planes, and a small camera module on the right front corner.
// Rotation follows the scroll progress of the nearest tall parent section.

const REST_Y = -28
const REST_X = 8
const LAYERS = [0, -2, -4, -6, -8]

function findScrollParent(el: HTMLElement): HTMLElement {
  let p = el.parentElement
  while (p && p !== document.body) {
    if (p.offsetHeight > window.innerHeight * 1.25) return p
    p = p.parentElement
  }
  return el
}

function Rims({ solid = false }: { solid?: boolean }) {
  const stroke = solid ? '#1c2224' : 'url(#gs-frame)'
  return (
    <g fill="none" stroke={stroke} strokeLinejoin="round">
      <rect x="28" y="22" width="132" height="92" rx="40" strokeWidth="10" />
      <rect x="200" y="22" width="132" height="92" rx="40" strokeWidth="10" />
      <path d="M158 52 Q180 36 202 52" strokeWidth="9" strokeLinecap="round" />
      <path d="M30 44 L16 40" strokeWidth="9" strokeLinecap="round" />
      <path d="M330 44 L344 40" strokeWidth="9" strokeLinecap="round" />
    </g>
  )
}

export function GlassesSpin({ className = '' }: { className?: string }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const rigRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const rig = rigRef.current
    if (!stage || !rig) return

    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      stage.style.setProperty('--gs-scale', String(Math.min(1.15, Math.max(0.55, w / 640))))
    })
    ro.observe(stage)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (y: number, x: number) => {
      rig.style.transform = `rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`
      const facing = Math.cos((y * Math.PI) / 180)
      stage.style.setProperty('--gs-facing', Math.max(0, facing) ** 6 + '')
      stage.style.setProperty('--gs-shadow', (0.55 + 0.45 * Math.abs(facing)).toFixed(3))
    }
    if (reduce.matches) {
      apply(REST_Y, REST_X)
      return () => ro.disconnect()
    }

    const track = findScrollParent(stage)
    let target = { y: -35, x: REST_X }
    let cur = { ...target }
    let raf = 0

    const measure = () => {
      const r = track.getBoundingClientRect()
      const vh = window.innerHeight
      let p: number
      if (track !== stage && r.height > vh) p = -r.top / (r.height - vh)
      else p = (vh - r.top) / (vh + r.height)
      p = Math.min(1, Math.max(0, p))
      target = { y: -35 + p * 395, x: REST_X + 10 * Math.sin(p * Math.PI * 2) }
    }
    const tick = () => {
      cur.y += (target.y - cur.y) * 0.14
      cur.x += (target.x - cur.x) * 0.14
      apply(cur.y, cur.x)
      if (Math.abs(target.y - cur.y) > 0.05 || Math.abs(target.x - cur.x) > 0.05) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    const onScroll = () => {
      measure()
      if (!raf) raf = requestAnimationFrame(tick)
    }
    measure()
    cur = { ...target }
    apply(cur.y, cur.x)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className={`glasses-spin ${className}`}
      role="img"
      aria-label="drigil smart glasses with a small camera on the frame"
    >
      <div className="gs-shadow" aria-hidden />
      <div className="gs-scale" aria-hidden>
        <div className="gs-rig" ref={rigRef}>
          {/* extrusion layers behind the front */}
          {LAYERS.slice(1).map((z) => (
            <svg key={z} className="gs-layer" viewBox="0 0 360 136" style={{ transform: `translateZ(${z}px)` }}>
              <Rims solid />
            </svg>
          ))}
          {/* front face with lenses */}
          <svg className="gs-layer gs-front" viewBox="0 0 360 136">
            <defs>
              <linearGradient id="gs-frame" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3a4447" />
                <stop offset="0.5" stopColor="#2A3133" />
                <stop offset="1" stopColor="#0F3B3A" />
              </linearGradient>
              <linearGradient id="gs-lens" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#F4EEE2" stopOpacity="0.55" />
                <stop offset="0.45" stopColor="#7FA5A0" stopOpacity="0.35" />
                <stop offset="1" stopColor="#0F3B3A" stopOpacity="0.55" />
              </linearGradient>
              <clipPath id="gs-clip-l"><rect x="28" y="22" width="132" height="92" rx="40" /></clipPath>
              <clipPath id="gs-clip-r"><rect x="200" y="22" width="132" height="92" rx="40" /></clipPath>
            </defs>
            <rect x="28" y="22" width="132" height="92" rx="40" fill="url(#gs-lens)" />
            <rect x="200" y="22" width="132" height="92" rx="40" fill="url(#gs-lens)" />
            <g fill="#fffaf0" opacity="0.5">
              <path clipPath="url(#gs-clip-l)" d="M40 120 L95 10 L118 10 L63 120 Z" />
              <path clipPath="url(#gs-clip-r)" d="M212 120 L267 10 L280 10 L225 120 Z" />
            </g>
            <Rims />
            <path d="M44 30 Q60 24 82 24" stroke="#fffaf0" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M216 30 Q232 24 254 24" stroke="#fffaf0" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>

          {/* camera module, right front corner */}
          <div className="gs-cam">
            {[1, 3, 5, 7, 9].map((z) => (
              <span key={z} className="gs-cam-disc" style={{ transform: `translateZ(${z}px)` }} />
            ))}
            <span className="gs-cam-face" style={{ transform: 'translateZ(10px)' }}>
              <span className="gs-cam-lens" />
              <span className="gs-cam-led" />
            </span>
            <span className="gs-cone" />
          </div>

          {/* temple arms */}
          {(['l', 'r'] as const).map((side) => (
            <div key={side} className={`gs-temple gs-temple-${side}`}>
              {[-3, 0, 3].map((t) => (
                <div key={t} className="gs-arm" style={{ transform: `translateZ(${t}px)` }}>
                  <span className="gs-hook" />
                  {side === 'r' && t !== 0 && <span className="gs-speaker" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
