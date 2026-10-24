import { NavLink, Outlet } from 'react-router-dom'
import { useTheme, type Theme } from '../theme'

const NAV = [
  { to: '/', label: 'Supervisor', end: true },
  { to: '/video', label: 'Video breakdown' },
  { to: '/teach', label: 'Teach' },
  { to: '/coach', label: 'Coach' },
  { to: '/steps', label: 'Worker steps' },
  { to: '/health', label: 'Health' },
]

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 32 32">
          <path d="M6 24h6v-6h6v-6h8" fill="none" stroke="var(--on-primary)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Stepwise
    </span>
  )
}

export function Layout() {
  const [theme, setTheme] = useTheme()
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" style={{ textDecoration: 'none' }} aria-label="Stepwise home">
            <Brand />
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button className="btn btn-ghost" onClick={() => setTheme(next[theme])} aria-label={`Theme: ${theme}. Change theme`}>
            {theme === 'dark' ? '☾ Dark' : theme === 'light' ? '☀ Light' : '◐ Auto'}
          </button>
        </div>
      </header>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
