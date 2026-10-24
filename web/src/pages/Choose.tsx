import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'

export function ChoosePage() {
  return (
    <AppShell back={{ to: '/', label: 'Home' }} title="Who is using IDD Help?">
      <div className="choose">
        <Link to="/worker" className="choice">
          <span className="choice-icon" aria-hidden>
            <svg viewBox="0 0 48 48" width="44" height="44">
              <circle cx="24" cy="16" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M10 42 q14 -22 28 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="choice-title">I'm a worker</span>
          <span className="choice-sub">See my tasks and get help step by step.</span>
        </Link>
        <Link to="/supervisor" className="choice">
          <span className="choice-icon" aria-hidden>
            <svg viewBox="0 0 48 48" width="44" height="44">
              <rect x="8" y="10" width="32" height="30" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M16 20h16M16 27h16M16 34h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="choice-title">I'm a supervisor</span>
          <span className="choice-sub">Help alerts, new tasks and worker reports.</span>
        </Link>
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>
        A coworker helping out? Open <Link to="/buddy">the help buddy page</Link> on your phone.
      </p>
    </AppShell>
  )
}
