import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTheme, type Theme } from '../theme'

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 32 32">
          <circle cx="10" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="22" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M16 16h0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      IDD Help
    </span>
  )
}

/** Minimal frame for the new pages: logo, an optional back link, theme switch. */
export function AppShell({ back, title, children }: { back?: { to: string; label: string }; title?: string; children: ReactNode }) {
  const [theme, setTheme] = useTheme()
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  return (
    <div className="app">
      <header className="app-bar">
        <Link to="/" className="plain-link" aria-label="IDD Help home">
          <Logo />
        </Link>
        <div className="row" style={{ gap: 4 }}>
          {back && (
            <Link to={back.to} className="btn btn-ghost">
              ← {back.label}
            </Link>
          )}
          <button className="btn btn-ghost" onClick={() => setTheme(next[theme])} aria-label={`Theme: ${theme}. Change theme`}>
            {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
          </button>
        </div>
      </header>
      <main className="app-main" id="main">
        {title && <h1 className="app-title">{title}</h1>}
        {children}
      </main>
    </div>
  )
}
