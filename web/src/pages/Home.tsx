import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BRAND } from '../components/Brand'
import { CorrectionBubble, GlassesMock, StatCard, StepTimeline, SupportMeter, type TimelineStep } from '../components/viz'
import { api, type Task } from '../lib/api'
import { PHOTOS } from '../lib/photos'
import { GlassesSpin } from '../components/GlassesSpin'
import { GlassesExplorer } from '../components/GlassesExplorer'
import '../styles/explorer.css'

/** Sample data used only when the edge API has no task yet. Shown with a "Sample" label. */
const SAMPLE: { title: string; voice: string; steps: TimelineStep[]; correction: string } = {
  title: 'Put a sleeve on a coffee cup',
  voice: 'Coach',
  steps: [
    { id: 1, instruction: 'Pick up one cup.' },
    { id: 2, instruction: 'Slide the sleeve on.' },
    { id: 3, instruction: 'Turn the words to face out.' },
    { id: 4, instruction: 'Set the cup on the tray.' },
  ],
  correction: 'Almost. Turn the sleeve so the words read up.',
}

/** First saved task from the edge API, or null (then the page uses SAMPLE). */
function useDemoTask() {
  const [task, setTask] = useState<Task | null>(null)
  useEffect(() => {
    let live = true
    api
      .tasks()
      .then((list) => (list[0] ? api.task(list[0].task_id) : null))
      .then((t) => live && t && t.steps?.length ? setTask(t) : undefined)
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return task
}

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

function FeatureStep({ n, title, text, children }: { n: string; title: string; text: string; children: React.ReactNode }) {
  return (
    <li className="hm-feature">
      <div className="hm-vignette card">{children}</div>
      <span className="hm-fn num">{n}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </li>
  )
}

const PRINCIPLES = [
  { t: 'Faces never leave the browser', d: 'Faces are blurred on the device before any frame is sent to a model.' },
  { t: 'No video is stored', d: 'Live checks look at single frames and keep nothing. Only step photos the coach saves remain.' },
  { t: 'Never “wrong.” Always “Almost.”', d: 'Every correction starts with “Almost.” and then says the fix, one action at a time.' },
  { t: 'A person is always one tap away', d: 'Asking for help reaches a coworker buddy first, then the supervisor. The AI never decides discipline.' },
]

const abs = (src: string) => (typeof window !== 'undefined' ? window.location.origin + src : src)

const GALLERY = [
  { p: PHOTOS.cafeGrind, say: 'Hold the portafilter under the grinder. Press the button.', note: 'The coach checks the portafilter is under the spout.' },
  { p: PHOTOS.cafeTamp, say: 'Press the coffee down flat.', note: 'One firm push with the tamper. The coffee should look level.' },
  { p: PHOTOS.cafeEspresso, say: 'Watch the coffee fill the cup.', note: 'The shot pours from the machine into a white cup.' },
  { p: PHOTOS.cafeLatte, say: 'Pour the milk slowly into the middle.', note: 'Steamed milk goes in last. A heart is a bonus.' },
  { p: PHOTOS.retailCart, say: 'Push the cart to the shampoo aisle.', note: 'The box of shampoo rides in the cart to the right aisle.' },
  { p: PHOTOS.retailShelf, say: 'Put each bottle on the shelf. Labels face out.', note: 'Bottles come out of the box one at a time.' },
  { p: PHOTOS.backroomBox, say: 'Lift the box onto the shelf.', note: 'In the stockroom, the full box goes on the right shelf.' },
]

const JOURNEY = [
  { when: 'Week 1', level: 0, title: 'Full help', d: 'Every step is spoken in full, with a photo of done right.', say: 'Great start. You finished the whole drink today.' },
  { when: 'Week 2', level: 1, title: 'Short cues', d: 'They know the steps. The coach just gives a short cue.', say: 'You did 3 steps on your own today. That’s 1 more than yesterday.' },
  { when: 'Week 3', level: 2, title: 'Alerts only', d: 'The coach stays quiet unless it spots a mistake.', say: 'Only one reminder all morning. You’re really getting this.' },
  { when: 'On their own', level: 3, title: 'Independent', d: 'Silence. They do the job. A person is still one tap away.', say: 'You did every step by yourself. Be proud of that.' },
]

const PRAISE = [
  { when: 'After a clean step', say: 'Nice. The labels all face out.' },
  { when: 'After a fix', say: 'You fixed it fast. That’s how pros do it.' },
  { when: 'End of the shift', say: 'You did 3 steps on your own today. That’s 1 more than yesterday.' },
]

const METHODS = ['Task analysis', 'Systematic instruction', 'Prompt fading', 'Video modeling', 'Natural supports']

export function HomePage() {
  const task = useDemoTask()
  const steps: TimelineStep[] = task
    ? task.steps.slice(0, 4).map((s) => ({ id: s.id, instruction: s.instruction }))
    : SAMPLE.steps
  const voice = task?.voice?.name || SAMPLE.voice
  const correction = SAMPLE.correction

  return (
    <AppShell footer>
      <div className="hm">
        {/* 1 · hero */}
        <section className="hm-hero on-rio" aria-labelledby="hm-h1">
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
              <GlassesMock
                photo={abs(PHOTOS.cafeGrind.src)}
                step={1}
                total={4}
                instruction="Hold the portafilter under the grinder. Press the button."
                correction="Nice. It is right under the spout."
                name="Maya"
                sample
              />
            </div>
          </div>
        </section>

        {/* 2 · the glasses */}
        <section className="hm-spin" aria-labelledby="hm-spin">
          <div className="hm-spin-sticky">
            <div className="hm-spin-text">
              <p className="eyebrow">The device</p>
              <h2 id="hm-spin">The glasses are the coach.</h2>
              <ul className="hm-callouts">
                <li><strong>A camera sees the work.</strong> It checks each step as they do it.</li>
                <li><strong>A speaker talks in their supervisor’s voice.</strong> One short step at a time.</li>
                <li><strong>A mic hears questions.</strong> “Is this right?” gets an answer right away.</li>
              </ul>
            </div>
            <div className="hm-spin-stage">
              <GlassesSpin />
            </div>
          </div>
        </section>

        {/* 2b · look closer: interactive explorer */}
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
          <ul className="hm-gallery">
            {GALLERY.map(({ p, say, note }) => (
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

        {/* 6 · voice */}
        <section className="hm-section hm-voice" aria-labelledby="hm-voice">
          <div>
            <p className="eyebrow">Their supervisor’s voice</p>
            <h2 id="hm-voice">Guidance from someone they know.</h2>
            <p className="hm-sub">
              With consent, {BRAND} clones the voice of their immediate supervisor. Every step, cue and fix sounds
              like a familiar person, not a stranger. No consent, no clone: a warm stock voice is used instead.
            </p>
            <p className="hm-sub">
              The coach also cheers them on. It says what they did well and how far they have come.
            </p>
          </div>
          <ul className="hm-praise">
            {PRAISE.map((x) => (
              <li key={x.when}>
                <span className="hm-fn num">{x.when}</span>
                <CorrectionBubble name="Maya, supervisor" text={x.say} />
              </li>
            ))}
            <li className="hm-praise-note">
              <span className="hm-fn num">When something is off</span>
              <CorrectionBubble name="Maya, supervisor" text={correction} />
            </li>
          </ul>
        </section>

        {/* 7 · how it works */}
        <section className="hm-section" id="how" aria-labelledby="hm-how">
          <p className="eyebrow">How it works</p>
          <h2 id="hm-how">Taught once. Coached every step.</h2>
          <ol className="hm-features">
            <FeatureStep n="01" title="Teach once" text="The supervisor does the task once while talking. Claude writes the steps, photos and likely mistakes.">
              <StepTimeline steps={steps.slice(0, 3)} current={3} finished orientation="vertical" size="sm" />
            </FeatureStep>
            <FeatureStep n="02" title="Coach live" text="A vision model checks each step. Fixes come in the supervisor’s voice and start with “Almost.”">
              <CorrectionBubble name={voice} text={correction} />
            </FeatureStep>
            <FeatureStep n="03" title="Fade support" text="Full instruction, then a short cue, then alerts only, then on their own.">
              <ul className="hm-meters">
                {[0, 1, 2, 3].map((l) => (
                  <li key={l}>
                    <span className="hm-meter-step num">Step {l + 1}</span>
                    <SupportMeter level={3 - l} />
                  </li>
                ))}
              </ul>
              <span className="hm-sample num">Sample</span>
            </FeatureStep>
            <FeatureStep n="04" title="Help is one tap" text="“I need help” pages a coworker buddy first, then the supervisor after 20 seconds.">
              <div className="hm-phone" aria-hidden>
                <span className="hm-phone-notch" />
                <span className="hm-phone-title">Jordan needs a hand</span>
                <span className="hm-phone-sub">Step 2 · Tamp the coffee flat</span>
                <span className="hm-phone-btn">I’ll help</span>
              </div>
            </FeatureStep>
          </ol>
        </section>

        {/* 8 · audiences */}
        <section className="hm-section" aria-labelledby="hm-who">
          <p className="eyebrow">Who it’s for</p>
          <h2 id="hm-who">One tool, two jobs.</h2>
          <div className="hm-roles">
            <Link to="/worker" className="hm-role card">
              <span className="eyebrow">For workers</span>
              <h3>Big photos. One step at a time.</h3>
              <p>Ask out loud: “Is this right?” The answer comes in your supervisor’s voice.</p>
              <span className="hm-role-go">I’m a worker <Arrow /></span>
            </Link>
            <Link to="/supervisor" className="hm-role card">
              <span className="eyebrow">For job coaches and supervisors</span>
              <h3>See the whole floor.</h3>
              <p>See who is on which step, who needs help, and which steps are getting easier.</p>
              <span className="hm-role-go">Open the coach floor <Arrow /></span>
            </Link>
          </div>
        </section>

        {/* 9 · principles */}
        <section className="hm-section" aria-labelledby="hm-dignity">
          <p className="eyebrow">Privacy and dignity</p>
          <h2 id="hm-dignity">Built for dignity.</h2>
          <ul className="hm-principles">
            {PRINCIPLES.map((p, i) => (
              <li key={p.t} className="card">
                <span className="hm-fn num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </li>
            ))}
          </ul>
          <p className="hm-note">
            Any example or simulated data in {BRAND} carries a <span className="num hm-sample-inline">Sample</span> label.
          </p>
        </section>

        {/* 10 · research teaser */}
        <section className="hm-section hm-research" aria-labelledby="hm-research">
          <div>
            <p className="eyebrow">Why it works</p>
            <h2 id="hm-research">Built on how job coaches already teach.</h2>
            <ul className="hm-chips">
              {METHODS.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
          <Link to="/why" className="btn-outline">
            Read the research <Arrow />
          </Link>
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
