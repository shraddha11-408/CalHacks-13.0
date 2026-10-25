// Home hero animation: a 10.5 s looping story. Jordan can't finish a coffee and is a little sad, the drigil glasses
// drop in, the coach's voice walks through 3 steps, Jordan does it. Pure inline SVG + CSS keyframes
// (styles/herostory.css). Pauses off-screen and in hidden tabs; reduced motion gets a 2x2 comic strip.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/herostory.css'

const C = {
  rio: '#0F3B3A', cream: '#ECE8E1', card: '#F7F5F0', piedra: '#C9C5BD', musgo: '#6F8A4B',
  sol: '#F3C14B', ink: '#2A3133', skin: '#C68B62', skinDk: '#A9714B', hair: '#7A3E25', coffee: '#6B4430',
  counter: '#1B4D4B', blush: '#E58C74',
}

const LABEL =
  'A short looping story. Jordan, a café worker, can’t finish the coffee and looks a little sad: the cup sits upside down. ' +
  'The drigil glasses float in and Jordan puts them on. The coach’s voice says: Hi Jordan, let’s do it together, first turn the cup over. ' +
  'Jordan flips the cup, pours the coffee and puts on the lid while a checklist ticks off 3 steps. ' +
  'The coffee is done, confetti falls, and the voice says: You did it!'

const SCENES = [
  { t: '0.85s', cap: '1 · Not yet' },
  { t: '3.7s', cap: '2 · Glasses on' },
  { t: '6.8s', cap: '3 · Step by step' },
  { t: '9.1s', cap: '4 · Did it!' },
]

type V = CSSProperties & Record<`--${string}`, string>
const o = (x: number, y: number, extra: Record<string, string> = {}): V => ({ '--o': `${x}px ${y}px`, ...extra })

function A({ c, at, d, children, style }: { c: string; at?: [number, number]; d?: string; children: ReactNode; style?: V }) {
  const s: V = { ...(at ? o(at[0], at[1]) : {}), ...(d ? { '--d': d } : {}), ...style }
  return <g className={`a ${c}`} style={s}>{children}</g>
}

function Bubble({ x, y, w, h, tail, children }: { x: number; y: number; w: number; h: number; tail: [number, number]; children: ReactNode }) {
  const bx = Math.min(Math.max(tail[0] + 14, x + 18), x + w - 30)
  return (
    <>
      <path d={`M${bx - 10} ${y + h - 2} L${tail[0]} ${tail[1]} L${bx + 12} ${y + h - 2} Z`} fill={C.card} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />
      <rect x={x} y={y} width={w} height={h} rx="18" fill={C.card} stroke={C.ink} strokeWidth="2.5" />
      <path d={`M${bx - 8} ${y + h - 2.5} L${bx + 10} ${y + h - 2.5}`} stroke={C.card} strokeWidth="4" />
      {children}
    </>
  )
}

function Sparkle({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const k = r * 0.28
  return <path d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r} Z`} fill={fill} />
}

const CONFETTI = [
  [178, '#ECE8E1', '0s', '520deg'], [214, '#6F8A4B', '.25s', '-480deg'], [252, '#C9C5BD', '.1s', '600deg'], [292, '#F7F5F0', '.4s', '-560deg'],
  [330, '#6F8A4B', '.05s', '500deg'], [366, '#ECE8E1', '.3s', '-620deg'], [404, '#C9C5BD', '.15s', '540deg'], [442, '#6F8A4B', '.45s', '-500deg'],
  [480, '#F7F5F0', '.2s', '580deg'], [140, '#C9C5BD', '.35s', '-540deg'], [500, '#ECE8E1', '.5s', '460deg'], [120, '#6F8A4B', '.12s', '600deg'],
] as const

function Scene({ id }: { id: string }) {
  const cupClip = `hs-cupclip-${id}`
  return (
    <>
      <defs>
        <clipPath id={cupClip}><path d="M355 253 L389 253 L385 291 L359 291 Z" /></clipPath>
      </defs>
      {/* room */}
      <rect width="520" height="420" fill={C.rio} />
      <circle cx="96" cy="70" r="120" fill="#fff" opacity=".035" />
      <circle cx="470" cy="40" r="90" fill="#fff" opacity=".03" />
      <path d="M44 0 V34 M150 0 V22" stroke={C.piedra} strokeWidth="2" opacity=".35" />
      <path d="M30 34 h28 l-6 14 h-16 Z M136 22 h28 l-6 14 h-16 Z" fill={C.piedra} opacity=".35" />

      {/* coffee machine */}
      <path d="M372 96 L458 96 L448 150 L382 150 Z" fill={C.cream} opacity=".35" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <g fill={C.coffee}>
        <ellipse cx="398" cy="134" rx="6" ry="4" /><ellipse cx="414" cy="128" rx="6" ry="4" transform="rotate(30 414 128)" />
        <ellipse cx="430" cy="136" rx="6" ry="4" /><ellipse cx="420" cy="141" rx="6" ry="4" transform="rotate(-20 420 141)" />
        <ellipse cx="405" cy="143" rx="6" ry="4" />
      </g>
      <rect x="330" y="150" width="140" height="150" rx="16" fill={C.card} stroke={C.ink} strokeWidth="3" />
      <rect x="342" y="174" width="60" height="28" rx="7" fill={C.piedra} stroke={C.ink} strokeWidth="2.5" />
      <rect x="366" y="201" width="12" height="11" rx="2" fill={C.ink} />
      <rect x="414" y="172" width="44" height="26" rx="6" fill={C.ink} />
      <circle cx="426" cy="185" r="4" fill={C.musgo} />
      <rect x="434" y="182" width="18" height="6" rx="3" fill={C.piedra} opacity=".5" />
      <circle cx="424" cy="216" r="7" fill={C.piedra} stroke={C.ink} strokeWidth="2.5" />
      <circle cx="446" cy="216" r="7" fill={C.piedra} stroke={C.ink} strokeWidth="2.5" />
      <rect x="342" y="289" width="62" height="8" rx="3" fill={C.ink} />

      {/* coffee stream */}
      <A c="stream" at={[372, 212]}><rect x="369" y="212" width="6" height="44" rx="3" fill={C.coffee} /></A>

      {/* cup: upside down in scene 1, flips over in scene 3 */}
      <A c="cup" at={[372, 272]}>
        <path d="M355 253 L389 253 L385 291 L359 291 Z" fill={C.cream} />
        <g clipPath={`url(#${cupClip})`}>
          <A c="fill" at={[372, 291]}><rect x="352" y="258" width="40" height="34" fill={C.coffee} /></A>
        </g>
        <path d="M389 262 q14 2 10 14 q-3 7 -12 6" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
        <rect x="357" y="266" width="30" height="11" fill={C.piedra} />
        <path d="M355 253 L389 253 L385 291 L359 291 Z" fill="none" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      </A>
      <A c="lid" at={[372, 252]}>
        <rect x="350" y="245" width="44" height="9" rx="4" fill={C.ink} />
        <rect x="364" y="239" width="16" height="7" rx="3" fill={C.ink} />
      </A>
      {/* steam hearts */}
      {['0s', '.9s'].map((d, i) => (
        <A key={i} c="heart" at={[372, 228]} d={d}>
          <path d="M372 236 c-10 -7 -12 -14 -6 -17 c3 -1.5 5.5 0 6 2.5 c0.5 -2.5 3 -4 6 -2.5 c6 3 4 10 -6 17 Z" fill="#fff" stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
        </A>
      ))}

      {/* Jordan */}
      <A c="dance" at={[250, 300]}>
        <A c="breathe" at={[250, 300]}>
          {/* left arm (hangs at his side in scene 1, cheering in scene 4) */}
          <A c="armL" at={[220, 238]}>
            <rect x="211" y="232" width="18" height="80" rx="9" fill={C.cream} stroke={C.ink} strokeWidth="2.5" />
            <circle cx="220" cy="312" r="10" fill={C.skin} stroke={C.ink} strokeWidth="2.5" />
          </A>
          {/* body */}
          <rect x="205" y="220" width="90" height="130" rx="36" fill={C.cream} stroke={C.ink} strokeWidth="3" />
          <path d="M224 252 h52 v80 h-52 Z" fill={C.piedra} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M224 252 l-8 -26 M276 252 l8 -26" stroke={C.ink} strokeWidth="2.5" />
          <rect x="238" y="272" width="24" height="14" rx="3" fill="none" stroke={C.ink} strokeWidth="2" />
          <rect x="241" y="205" width="18" height="20" fill={C.skinDk} />
          {/* head */}
          <A c="headtilt" at={[250, 212]}>
            <circle cx="206" cy="172" r="9" fill={C.skin} stroke={C.ink} strokeWidth="2.5" />
            <circle cx="294" cy="172" r="9" fill={C.skin} stroke={C.ink} strokeWidth="2.5" />
            <circle cx="250" cy="168" r="44" fill={C.skin} stroke={C.ink} strokeWidth="3" />
            <g fill={C.hair} stroke={C.ink} strokeWidth="2.5">
              <path d="M207 160 C200 120 230 104 252 110 C280 104 304 126 293 160 C283 140 262 134 250 138 C236 132 216 140 207 160 Z" />
              <path d="M252 111 c-4 -10 4 -16 10 -12" fill="none" strokeLinecap="round" />
            </g>
            <circle cx="226" cy="188" r="6" fill={C.blush} opacity=".55" />
            <circle cx="274" cy="188" r="6" fill={C.blush} opacity=".55" />
            {/* calm, slightly sad face (scene 1): soft brows, eyes glancing down at the cup, small downturned mouth */}
            <A c="s1only">
              <path d="M227 159 L240 154.5 M260 154.5 L273 159" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" />
              {[234, 266].map((x) => (
                <A key={x} c="blink" at={[x, 174]}>
                  <ellipse cx={x + 0.8} cy="174" rx="5" ry="6.5" fill={C.ink} />
                  <circle cx={x + 2} cy="172.4" r="1.6" fill="#fff" />
                </A>
              ))}
              <path d="M241 197 q9 -6 18 0" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
            </A>
            {/* happy face (scenes 2-4) */}
            <A c="nots1">
              <A c="browup" at={[250, 154]}>
                <path d="M226 156 q7 -6 15 -1 M259 155 q8 -5 15 1" fill="none" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
              </A>
              {[234, 266].map((x) => (
                <A key={x} c="blink" at={[x, 172]}>
                  <ellipse cx={x} cy="172" rx="5" ry="6.5" fill={C.ink} />
                  <circle cx={x + 1.8} cy="169.5" r="1.8" fill="#fff" />
                </A>
              ))}
            </A>
            <A c="s23only"><path d="M238 189 q12 11 24 0" fill="none" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" /></A>
            <A c="s4only">
              <path d="M235 186 q15 24 30 0 Z" fill={C.ink} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M243 196 q7 -5 14 0 q-7 6 -14 0" fill={C.blush} />
            </A>
            {/* the glasses */}
            <A c="gdrop" at={[250, 172]}>
              <path d="M220 167 L208 165 M280 167 L292 165" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
              <rect x="220" y="160" width="28" height="24" rx="9" fill="#fff" fillOpacity=".22" stroke={C.ink} strokeWidth="4" />
              <rect x="252" y="160" width="28" height="24" rx="9" fill="#fff" fillOpacity=".22" stroke={C.ink} strokeWidth="4" />
              <path d="M248 169 q2 -4 4 0" fill="none" stroke={C.ink} strokeWidth="3.5" />
              <circle cx="285" cy="159" r="5" fill={C.ink} />
              <circle cx="285" cy="159" r="2" fill={C.piedra} />
              <A c="led" at={[215, 158]}><circle cx="215" cy="158" r="3.2" fill={C.sol} /></A>
            </A>
          </A>
          {/* right arm (taps the cup, flips it, cheers) */}
          <A c="armR" at={[280, 238]}>
            <rect x="271" y="232" width="18" height="84" rx="9" fill={C.cream} stroke={C.ink} strokeWidth="2.5" />
            <circle cx="280" cy="316" r="10" fill={C.skin} stroke={C.ink} strokeWidth="2.5" />
          </A>
        </A>
      </A>

      {/* scene 1: one small, quiet question mark by the cup */}
      <A c="qpop" at={[372, 228]}>
        <circle cx="372" cy="228" r="11" fill={C.card} stroke={C.ink} strokeWidth="2.2" />
        <text x="372" y="233.5" textAnchor="middle" fontSize="14" fontWeight="800" fill={C.ink}>?</text>
      </A>

      {/* scene 2: sparkle + boop */}
      <A c="sparkle" at={[300, 140]}><Sparkle x={300} y={140} r={14} fill={C.sol} /></A>
      <A c="sparkle" at={[204, 130]} d=".25s"><Sparkle x={204} y={130} r={9} fill={C.sol} /></A>
      <A c="boop" at={[180, 206]}><text x="180" y="210" textAnchor="middle" fontSize="15" fontWeight="800" fill={C.cream} fontStyle="italic">boop!</text></A>

      {/* coach voice bubbles */}
      <A c="bub bub-hi" at={[300, 104]}>
        <Bubble x={286} y={14} w={222} h={82} tail={[292, 118]}>
          <circle cx="306" cy="34" r="5" fill={C.sol} />
          <text x="316" y="38" fontSize="11" fontWeight="700" fill={C.musgo}>Coach Maya</text>
          <text x="302" y="58" fontSize="14.5" fontWeight="600" fill={C.ink}>Hi Jordan. Let’s do it</text>
          <text x="302" y="77" fontSize="14.5" fontWeight="600" fill={C.ink}>together. Turn the cup over.</text>
        </Bubble>
      </A>
      <A c="bub bub-nice" at={[310, 104]}>
        <Bubble x={300} y={46} w={96} h={42} tail={[292, 118]}>
          <text x="348" y="73" textAnchor="middle" fontSize="16" fontWeight="700" fill={C.ink}>Nice.</text>
        </Bubble>
      </A>
      <A c="bub bub-lid" at={[310, 104]}>
        <Bubble x={300} y={46} w={146} h={42} tail={[292, 118]}>
          <text x="373" y="73" textAnchor="middle" fontSize="16" fontWeight="700" fill={C.ink}>Now the lid.</text>
        </Bubble>
      </A>
      <A c="bub bub-did" at={[320, 100]}>
        <Bubble x={296} y={30} w={176} h={54} tail={[292, 116]}>
          <text x="384" y="65" textAnchor="middle" fontSize="22" fontWeight="800" fill={C.musgo}>You did it!</text>
        </Bubble>
      </A>

      {/* checklist */}
      <A c="card" at={[90, 180]}>
        <rect x="16" y="118" width="152" height="124" rx="16" fill={C.card} stroke={C.ink} strokeWidth="2.5" />
        <text x="32" y="142" fontSize="12" fontWeight="800" fill={C.ink} letterSpacing=".04em">MAKE A COFFEE</text>
        {(['Cup over', 'Pour coffee', 'Lid on'] as const).map((t, i) => {
          const y = 164 + i * 28
          return (
            <g key={t}>
              <circle cx="40" cy={y} r="9.5" fill="none" stroke={C.piedra} strokeWidth="2.5" />
              <A c={`tick${i + 1}`} at={[40, y]}><circle cx="40" cy={y} r="10.5" fill={C.musgo} /></A>
              <path className={`a chk chk${i + 1}`} d={`M35 ${y} l3.5 4 l7 -8`} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <text x="58" y={y + 5} fontSize="14" fontWeight="600" fill={C.ink}>{t}</text>
            </g>
          )
        })}
      </A>
      <A c="badge" at={[92, 266]}>
        <rect x="14" y="250" width="166" height="34" rx="17" fill={C.musgo} stroke={C.ink} strokeWidth="2.5" />
        <path d="M36 257 l3 6.2 6.8 1 -4.9 4.8 1.2 6.8 -6.1 -3.2 -6.1 3.2 1.2 -6.8 -4.9 -4.8 6.8 -1 Z" fill={C.cream} />
        <text x="50" y="272" fontSize="11.5" fontWeight="700" fill={C.card}>On your own: 3 steps</text>
      </A>

      {/* scene 4: confetti + twinkles */}
      {CONFETTI.map(([x, fill, d, r], i) => (
        <A key={i} c="confetti" at={[x, -10]} d={d} style={{ '--r': r }}>
          {i % 3 === 0 ? <circle cx={x} cy={-10} r="4" fill={fill} /> : <rect x={x - 3} y={-14} width={i % 2 ? 6 : 10} height={i % 2 ? 10 : 5} rx="1.5" fill={fill} />}
        </A>
      ))}
      <A c="twinkle" at={[318, 150]}><Sparkle x={318} y={150} r={10} fill={C.cream} /></A>
      <A c="twinkle" at={[186, 110]} d=".3s"><Sparkle x={186} y={110} r={8} fill={C.cream} /></A>
      <A c="twinkle" at={[420, 236]} d=".6s"><Sparkle x={420} y={236} r={7} fill={C.cream} /></A>

      {/* counter */}
      <rect x="0" y="298" width="520" height="122" fill={C.counter} />
      <rect x="-4" y="294" width="528" height="14" rx="7" fill={C.cream} stroke={C.ink} strokeWidth="2.5" />
      <path d="M0 400 H520" stroke="#fff" strokeOpacity=".06" strokeWidth="2" />

      {/* loop fade */}
      <A c="fade"><rect width="520" height="420" fill={C.rio} /></A>

      {/* caption + progress */}
      {SCENES.map((s, i) => (
        <A key={s.cap} c={`cap${i + 1}`}>
          <text x="24" y="352" fontSize="17" fontWeight="700" fill={C.cream}>{s.cap}</text>
        </A>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={24 + i * 34} y="368" width="28" height="5" rx="2.5" fill={C.cream} opacity=".22" />
          <A c={`pg${i + 1}`} at={[24 + i * 34, 370]}><rect x={24 + i * 34} y="368" width="28" height="5" rx="2.5" fill={C.cream} /></A>
        </g>
      ))}
    </>
  )
}

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)'
  const [r, setR] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setR(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return r
}

export function HeroStory() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  const [tabShown, setTabShown] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    const on = () => setTabShown(document.visibilityState !== 'hidden')
    on()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // Reduced motion: freeze each comic panel at its scene's moment (same clock as the loop).
  useEffect(() => {
    if (!reduced || !ref.current) return
    ref.current.querySelectorAll<SVGSVGElement>('.hs-strip svg').forEach((svg, i) => {
      const t = parseFloat(SCENES[i].t) * 1000
      svg.getAnimations?.({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = t })
    })
  }, [reduced])

  const paused = !visible || !tabShown
  return (
    <div ref={ref} className={`hero-story${paused ? ' is-paused' : ''}`} role="img" aria-label={LABEL}>
      {reduced ? (
        <div className="hs-strip">
          {SCENES.map((s, i) => (
            <svg key={s.cap} className="hs-svg" viewBox="0 0 520 420" aria-hidden="true" style={{ '--t': s.t } as V}>
              <Scene id={`p${i}`} />
            </svg>
          ))}
        </div>
      ) : (
        <svg className="hs-svg" viewBox="0 0 520 420" aria-hidden="true">
          <Scene id="main" />
        </svg>
      )}
    </div>
  )
}
