import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BRAND } from '../components/Brand'
import { StatCard, SupportMeter } from '../components/viz'
import { PHOTOS } from '../lib/photos'
import { HeroStory } from '../components/HeroStory'
import { GlassesExplorer } from '../components/GlassesExplorer'
import '../styles/explorer.css'

const STATS = {
  bls: { value: '22.7%', label: 'of people with a disability were employed in 2024, against 65.5% without one.' },
  dsp: { value: '39.7%', label: 'yearly turnover of direct support staff in 2023, the workforce job coaches come from.' },
  tech: { value: '41', label: 'single-case studies in a meta-analysis found step-by-step prompting technology supports employment outcomes.' },
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

const CAFE = [
  { p: PHOTOS.cafeGrind, say: 'Hold the portafilter under the grinder. Press the button.', note: 'The coach checks the portafilter is under the spout.' },
  { p: PHOTOS.cafeTamp, say: 'Press the coffee down flat.', note: 'One firm push with the tamper. The coffee should look level.' },
  { p: PHOTOS.cafeEspresso, say: 'Watch the coffee fill the cup.', note: 'The shot pours from the machine into a white cup.' },
  { p: PHOTOS.cafeLatte, say: 'Pour the milk slowly into the middle.', note: 'Steamed milk goes in last. A heart is a bonus.' },
]

const STORE = [
  { p: PHOTOS.retailCart, say: 'Push the cart to the shampoo aisle.', note: 'The box of shampoo rides in the cart to the right aisle.' },
  { p: PHOTOS.retailShelf, say: 'Put each bottle on the shelf. Labels face out.', note: 'Bottles come out of the box one at a time.' },
  { p: PHOTOS.backroomBox, say: 'Lift the box onto the shelf.', note: 'In the stockroom, the full box goes on the right shelf.' },
]

type Shot = (typeof CAFE)[number]

function Shots({ items }: { items: Shot[] }) {
  return (
    <ul className={`hm-gallery hm-cols-${items.length}`}>
      {items.map(({ p, say, note }) => (
        <li key={p.src} className="hm-shot card">
          <div className="hm-shot-img">
            <img src={p.src} alt={p.alt} loading="lazy" />
            <span className="hm-tag num">{p.place}</span>
          </div>
          <div className="hm-shot-body">
            <h3>{p.task}</h3>
            <p className="hm-say">“{say}”</p>
            <p className="hm-cap">{note}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

const JOURNEY = [
  { when: 'Week 1', level: 0, title: 'Full help', d: 'Every step is spoken in full, with a photo of done right.', say: 'Great start. You finished the whole drink today.' },
  { when: 'Week 2', level: 1, title: 'Short cues', d: 'They know the steps. The coach just gives a short cue.', say: 'You did 3 steps on your own today. That’s 1 more than yesterday.' },
  { when: 'Week 3', level: 2, title: 'Alerts only', d: 'The coach stays quiet unless it spots a mistake.', say: 'Only one reminder all morning. You’re really getting this.' },
  { when: 'On their own', level: 3, title: 'Independent', d: 'Silence. They do the job. A person is still one tap away.', say: 'You did every step by yourself. Be proud of that.' },
]

export function HomePage() {
  return (
    <AppShell footer>
      <div className="hm">
        {/* 1 · hero */}
        <section className="hm-hero on-rio" aria-labelledby="hm-h1">
          {/* brand corner: a quarter circle in the top-left with the wordmark (the header already names the page) */}
          <div className="hm-corner" aria-hidden="true">
            <span className="hm-corner-ring r2" />
            <span className="hm-corner-ring r1" />
            <span className="hm-corner-disc">
              <span className="hm-corner-word">{BRAND}</span>
              <span className="hm-corner-tag">little steps<br />to independence</span>
            </span>
          </div>
          <div className="hm-hero-inner">
            <div className="hm-hero-text">
              <p className="eyebrow">For workers with intellectual and developmental disabilities</p>
              <h1 id="hm-h1">A coach in their ear. Until they don’t need one.</h1>
              <p className="hm-lede">
                {BRAND} is a launch pad for a new job. Smart glasses guide each step of a new task in their
                supervisor’s voice. Help fades as they learn, until they do the job on their own.
              </p>
              <div className="hm-ctas">
                <Link to="/choose" className="btn hm-btn-cream">
                  Open {BRAND} <Arrow />
                </Link>
                <a href="#journey" className="btn-outline">
                  See how help fades
                </a>
              </div>
              <p className="hm-trust num">Faces blurred in the browser · No video stored</p>
            </div>
            <div className="hm-hero-visual">
              <HeroStory />
            </div>
          </div>
        </section>

        {/* 2 · look closer: interactive explorer */}
        <GlassesExplorer />

        {/* 3 · the gap */}
        <section className="hm-section" aria-labelledby="hm-gap">
          <p className="eyebrow">Why it matters</p>
          <h2 id="hm-gap">The first weeks on a job are the hardest.</h2>
          <p className="hm-sub">
            People with intellectual and developmental disabilities are capable workers. What they often lack is
            support at the start, when every task is new. Job coaches can’t be there every day.
          </p>
          <div className="hm-stats">
            {[STATS.bls, STATS.dsp, STATS.tech].map((s) => (
              <StatCard key={s.value} value={s.value} label={s.label} />
            ))}
          </div>
        </section>

        {/* 4 · real jobs */}
        <section className="hm-section" aria-labelledby="hm-jobs">
          <p className="eyebrow">Real jobs, first-person view</p>
          <h2 id="hm-jobs">What they see. What the coach says.</h2>
          <p className="hm-sub">These are views through the glasses at a café, a store and a stockroom.</p>
          <h3 className="hm-group">Café</h3>
          <Shots items={CAFE} />
          <h3 className="hm-group">Store and stockroom</h3>
          <Shots items={STORE} />
        </section>

        {/* 5 · journey */}
        <section className="hm-section" id="journey" aria-labelledby="hm-journey">
          <p className="eyebrow">From day one to on their own</p>
          <h2 id="hm-journey">Less help every week.</h2>
          <p className="hm-sub">
            Each step gets less help as they master it. Three clean runs move a step down. Two slips bring help
            back. The goal is a worker who does the job alone.
          </p>
          <ol className="hm-journey">
            {JOURNEY.map((j) => (
              <li key={j.when} className="hm-stage card">
                <span className="hm-sample num">Sample</span>
                <span className="hm-fn num">{j.when}</span>
                <h3>{j.title}</h3>
                <SupportMeter level={j.level} />
                <p>{j.d}</p>
                <p className="hm-say">“{j.say}”</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 11 · CTA */}
        <section className="hm-section hm-cta-wrap">
          <div className="hm-cta card">
            <div>
              <h2>Try it with your webcam.</h2>
              <p>The laptop camera stands in for the glasses.</p>
            </div>
            <Link to="/choose" className="btn btn-primary">
              Open {BRAND} <Arrow />
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
