import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'

/**
 * A worker is unsure about a task → puts on the glasses → does it with confidence.
 * Pure SVG + CSS keyframes (styles/idd.css). With reduced motion the final, confident frame shows.
 */
function Story() {
  return (
    <svg className="story" viewBox="0 0 320 210" role="img" aria-label="A worker looks unsure about a task, puts on the glasses, then does the task with confidence.">
      <g className="story-scene">
        {/* table + task */}
        <rect x="150" y="150" width="150" height="10" rx="5" fill="var(--fig-table)" />
        <rect x="160" y="160" width="8" height="40" rx="3" fill="var(--fig-table)" />
        <rect x="282" y="160" width="8" height="40" rx="3" fill="var(--fig-table)" />
        <g className="cup">
          <path d="M228 112 h28 l-4 38 h-20 z" fill="var(--fig-cup)" stroke="var(--line)" strokeWidth="2" />
          <rect x="225" y="106" width="34" height="8" rx="3" fill="var(--fig-pants)" />
        </g>
        <path className="sleeve" d="M230 126 h24 l-1.5 12 h-21 z" fill="var(--fig-sleeve)" />

        {/* person */}
        <g className="person">
          <rect x="76" y="150" width="14" height="50" rx="7" fill="var(--fig-pants)" />
          <rect x="96" y="150" width="14" height="50" rx="7" fill="var(--fig-pants)" />
          <rect x="70" y="96" width="46" height="62" rx="20" fill="var(--fig-shirt)" />
          <path className="arm-back" d="M76 108 q-14 26 -2 44" fill="none" stroke="var(--fig-shirt)" strokeWidth="12" strokeLinecap="round" />
          <path className="arm-reach" d="M110 108 q30 6 112 22" fill="none" stroke="var(--fig-shirt)" strokeWidth="12" strokeLinecap="round" />
          <g className="head">
            <circle cx="93" cy="70" r="24" fill="var(--fig-skin)" />
            <path d="M69 66 q2 -26 26 -24 q20 2 22 22 q-12 -10 -30 -6 q-10 2 -18 8 z" fill="var(--fig-hair)" />
            <circle cx="86" cy="72" r="2.6" fill="var(--fig-hair)" />
            <circle cx="102" cy="72" r="2.6" fill="var(--fig-hair)" />
            <path className="brow-worry" d="M81 66 l9 -4 M107 66 l-9 -4" stroke="var(--fig-hair)" strokeWidth="2" strokeLinecap="round" />
            <path className="mouth-unsure" d="M87 84 q6 -3 12 0" fill="none" stroke="var(--fig-hair)" strokeWidth="2.4" strokeLinecap="round" />
            <path className="mouth-smile" d="M85 82 q8 8 16 0" fill="none" stroke="var(--fig-hair)" strokeWidth="2.6" strokeLinecap="round" />
            <g className="glasses">
              <circle cx="86" cy="72" r="7" fill="var(--fig-lens)" fillOpacity="0.35" stroke="var(--ink)" strokeWidth="2.4" />
              <circle cx="102" cy="72" r="7" fill="var(--fig-lens)" fillOpacity="0.35" stroke="var(--ink)" strokeWidth="2.4" />
              <path d="M93 72 h2 M79 71 l-8 -2 M109 71 l8 -2" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
              <circle className="cam-dot" cx="112" cy="68" r="2.2" fill="var(--primary)" />
            </g>
          </g>
        </g>

        {/* unsure */}
        <g className="unsure" fill="var(--ink-2)" fontFamily="var(--font)" fontWeight="700">
          <text className="q q1" x="56" y="40" fontSize="22">?</text>
          <text className="q q2" x="120" y="30" fontSize="18">?</text>
          <text className="q q3" x="134" y="54" fontSize="14">?</text>
        </g>
        {/* confident */}
        <g className="win">
          <circle cx="242" cy="78" r="15" fill="var(--success)" />
          <path d="M235 78 l5 5 l9 -10" fill="none" stroke="var(--surface)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path className="spark" d="M140 52 l3 -9 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 z" fill="var(--almost-fill)" />
        </g>
      </g>
    </svg>
  )
}

export function HomePage() {
  return (
    <AppShell>
      <section className="hero">
        <Story />
        <h1 className="hero-title">IDD Help</h1>
        <p className="hero-sub">A job coach in a pair of glasses. Step-by-step help for workers with intellectual and developmental disabilities.</p>
        <Link to="/choose" className="btn btn-primary btn-xl hero-cta">
          CONTINUE
        </Link>
      </section>
    </AppShell>
  )
}
