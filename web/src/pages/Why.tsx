import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BRAND } from '../components/Brand'
import { CorrectionBubble, StatCard, StepTimeline, SupportMeter } from '../components/viz'
import { PHOTOS } from '../lib/photos'
import '../styles/why.css'

const DEMO = [
  { id: 1, instruction: 'Pick up one cup.' },
  { id: 2, instruction: 'Slide the sleeve on.' },
  { id: 3, instruction: 'Turn the words out.' },
]

type Method = { id: string; name: string; what: ReactNode; evidence: ReactNode; feature: ReactNode; link: { to: string; label: string }; visual: ReactNode }

const METHODS: Method[] = [
  {
    id: 'task-analysis',
    name: 'Task analysis',
    what: 'Break a job into small, ordered steps, each with a clear sign that it is done. It is the base of systematic instruction.',
    evidence: (
      <>Supported-employment job-site training starts from a task analysis. In single-case studies, young adults with moderate ID completed multi-step tasks on their own using picture, audio and video prompts on a handheld device.</>
    ),
    feature: <>Teach once: Claude splits the coach’s narrated demo into steps with a photo, a “done right” description and the common mistake for each.</>,
    link: { to: '/supervisor?tab=add', label: 'Add a task' },
    visual: <StepTimeline steps={DEMO} current={3} finished orientation="vertical" size="sm" />,
  },
  {
    id: 'systematic-instruction',
    name: 'Systematic instruction and immediate feedback',
    what: 'Give a prompt, watch the response, and correct errors right away, before they become habits.',
    evidence: (
      <>Most-to-least prompting matched constant time delay in effect, with less training time, fewer trials and fewer errors. Poor quality and rate of work is one of the main reasons people lose jobs.</>
    ),
    feature: <>Coach live: a vision model checks each step as the worker moves. A correction plays only when the check is sure, starts with “Almost.”, and says the fix. When unsure, it stays silent.</>,
    link: { to: '/worker', label: 'Worker view' },
    visual: <CorrectionBubble name="Coach" text="Almost. Turn the sleeve so the words read up." />,
  },
  {
    id: 'prompt-fading',
    name: 'Prompting and prompt fading',
    what: 'Start with as much help as the person needs, then step it back so the skill belongs to the worker, not the prompt.',
    evidence: (
      <>A review of 19 single-case studies (2000–2021) found most-to-least prompting effective across skills for people with developmental disabilities. Fading guides recommend starting to fade on day one, at the worker’s pace.</>
    ),
    feature: <>Fade support: each step has four levels (full help, short cue, alerts only, independent). It steps up after 3 clean runs and back after 2 errors in the last 5.</>,
    link: { to: '/supervisor', label: 'Coach floor' },
    visual: (
      <ul className="why-meters">
        {[0, 1, 2, 3].map((l) => (
          <li key={l}><SupportMeter level={l} /></li>
        ))}
      </ul>
    ),
  },
  {
    id: 'video-modeling',
    name: 'Video modeling and video prompting',
    what: 'Show what “done right” looks like, from a model of the actual task, at the moment it is needed.',
    evidence: (
      <>A review of 20 single-case studies (67 participants with autism and/or ID) found video modeling effective for independent-living skills, most of all when combined with prompting. A meta-analysis of 41 studies found applied cognitive technology supports employment-related outcomes.</>
    ),
    feature: <>Each step shows the supervisor’s own reference photo, “Done right looks like this,” taken from the narrated demo, next to the live camera.</>,
    link: { to: '/worker', label: 'Worker view' },
    visual: (
      <figure className="why-photo">
        <img src={PHOTOS.cafeTamp.src} alt={PHOTOS.cafeTamp.alt} loading="lazy" />
        <figcaption>
          <span className="eyebrow">Done right looks like this</span>
          Reference photo for “{PHOTOS.cafeTamp.task}”
        </figcaption>
      </figure>
    ),
  },
  {
    id: 'natural-supports',
    name: 'Natural supports',
    what: 'Coworkers, not only paid staff, help the person on the job.',
    evidence: (
      <>A scoping review of 17 articles found that coworker support went with more engagement in tasks, more interaction with coworkers, and gains in wages, hours and job tenure.</>
    ),
    feature: <>Help is one tap: “I need help” pages a named coworker buddy first, and the supervisor after 20 seconds. Only one person can claim it.</>,
    link: { to: '/buddy', label: 'Buddy phone' },
    visual: (
      <div className="why-route" aria-hidden>
        <span className="why-route-node">Worker</span>
        <span className="why-route-line" />
        <span className="why-route-node on">Buddy</span>
        <span className="why-route-line" />
        <span className="why-route-node">Supervisor <em className="num">20 s</em></span>
      </div>
    ),
  },
]

const TOC = [
  ['problem', 'The problem'],
  ['works', 'What the research says works'],
  ['language', 'Language we use'],
  ['limits', `What ${BRAND} doesn’t do`],
] as const

export function WhyPage() {
  return (
    <AppShell footer>
      <div className="why">
        <nav className="why-toc" aria-label="On this page">
          <p className="eyebrow">On this page</p>
          <ul>
            {TOC.map(([id, t]) => (
              <li key={id}><a href={`#${id}`}>{t}</a></li>
            ))}
          </ul>
        </nav>

        <article className="why-body">
          <header className="why-head">
            <p className="eyebrow">Why it works</p>
            <h1>A launch pad for a new job.</h1>
            <p className="why-lede">
              Many adults with intellectual and developmental disabilities (IDD) want to work, and supported employment
              helps them do it. The first weeks in a new workplace, with new tasks, need the most support, and a job
              coach can’t stand beside every worker every day. {BRAND} applies methods job coaches already use, in
              the supervisor’s own voice, and fades that help as the worker learns, so the job becomes theirs.
            </p>
          </header>

          <section id="problem" aria-labelledby="why-problem">
            <h2 id="why-problem">The problem</h2>
            <p>
              In 2024, 22.7% of people with any disability in the US were employed, against 65.5% of people without
              one. That figure covers all disabilities; federal labor statistics do not report IDD
              separately. Among adults with IDD who receive state developmental-disability services, a national survey
              reports that 17% have a paid community job.
            </p>
            <p>
              The people who deliver support are stretched. Direct support staff turnover averaged 39.7% in 2023{' '}, and job coaches come from the same workforce. Coach hours are scarce, so the teaching
              has to last between visits.
            </p>
            <div className="why-stats">
              <StatCard value="22.7%" label="of people with a disability were employed in 2024 (65.5% without)." />
              <StatCard value="39.7%" label="yearly turnover of direct support staff, 2023." />
            </div>
          </section>

          <section id="works" aria-labelledby="why-works">
            <h2 id="why-works">What the research says works</h2>
            <p>Each feature maps to a method from supported-employment practice. Here is the evidence, and where it shows up.</p>
            <ol className="why-methods">
              {METHODS.map((m, i) => (
                <li key={m.id} id={m.id} className="why-method card">
                  <div className="why-method-text">
                    <span className="why-n num">{String(i + 1).padStart(2, '0')}</span>
                    <h3>{m.name}</h3>
                    <dl>
                      <dt>What it is</dt>
                      <dd>{m.what}</dd>
                      <dt>What the evidence says</dt>
                      <dd>{m.evidence}</dd>
                      <dt>In {BRAND}</dt>
                      <dd>
                        {m.feature} <Link to={m.link.to}>{m.link.label}</Link>
                      </dd>
                    </dl>
                  </div>
                  <div className="why-visual">{m.visual}</div>
                </li>
              ))}
            </ol>
            <p className="why-small">
              Most of this evidence comes from single-case studies and reviews. The coach’s cloned voice is a design
              choice for continuity; we found no study of it and make no research claim for it.
            </p>
          </section>

          <section id="language" aria-labelledby="why-language">
            <h2 id="why-language">Language we use</h2>
            <p>
              We say “people with intellectual and developmental disabilities” by default and follow each person’s own
              preference when they tell us. We describe the support, not the person:
              “Jordan uses step reminders,” not “Jordan can’t remember steps.” In the product, nothing says “wrong” or
              “no” alone. Every correction is “Almost.” plus the fix.
            </p>
          </section>

          <section id="limits" aria-labelledby="why-limits">
            <h2 id="why-limits">What {BRAND} doesn’t do</h2>
            <ul className="why-limits">
              <li><strong>No discipline or performance decisions.</strong> Reports help a coach plan support. People decide.</li>
              <li><strong>Silence when unsure.</strong> A wrong correction is worse than none, so an unclear check says nothing.</li>
              <li><strong>Simulated data is labeled.</strong> Sample and simulated numbers carry a “Sample” label wherever they appear.</li>
              <li><strong>No video stored, no faces sent.</strong> Faces are blurred in the browser before any frame leaves it.</li>
            </ul>
          </section>
        </article>
      </div>
    </AppShell>
  )
}
