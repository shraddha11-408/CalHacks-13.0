import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BRAND } from '../components/Brand'

const ico = (d: string) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const ROLES = [
  { to: '/worker', title: 'I’m a worker', text: 'See my tasks. Get help step by step.', icon: ico('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0') },
  { to: '/supervisor', title: 'I’m a supervisor', text: 'Help alerts, new tasks, worker progress.', icon: ico('M3 21V9l9-6 9 6v12M9 21v-6h6v6') },
  { to: '/buddy', title: 'I’m a help buddy', text: 'Get a ping when a coworker needs a hand.', icon: ico('M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2') },
]

export function ChoosePage() {
  return (
    <AppShell footer>
      <section className="ch" aria-labelledby="ch-h1">
        <p className="eyebrow">Open {BRAND}</p>
        <h1 id="ch-h1">Who is using {BRAND}?</h1>
        <p className="hm-sub">Pick one. You can switch any time from the top of the page.</p>
        <ul className="ch-roles">
          {ROLES.map((r) => (
            <li key={r.to}>
              <Link to={r.to} className="ch-role card">
                <span className="ch-icon">{r.icon}</span>
                <h2>{r.title}</h2>
                <p>{r.text}</p>
                <span className="ch-arrow" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="hm-note">Trying it out? The laptop camera and speaker stand in for the glasses.</p>
      </section>
    </AppShell>
  )
}
