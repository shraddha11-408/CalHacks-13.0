import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AppIcon, BRAND } from './Brand'
import { useTheme, type Theme } from '../theme'

const THEME_LABEL: Record<Theme, string> = { system: 'Theme: same as device', light: 'Theme: light', dark: 'Theme: dark' }
const THEME_NEXT: Record<Theme, string> = { system: 'light', light: 'dark', dark: 'same as device' }

/** One 44 px button: system → light → dark. The label says the current mode and what a press does. */
export function ThemeToggle() {
  const [theme, , cycle] = useTheme()
  return (
    <button
      type="button"
      className="sh-theme"
      onClick={cycle}
      aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_NEXT[theme]}.`}
      title={`${THEME_LABEL[theme]} (click for ${THEME_NEXT[theme]})`}
    >
      {theme === 'light' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : theme === 'dark' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  )
}

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/why', label: 'Why it works' },
  { to: '/worker', label: 'Worker' },
  { to: '/supervisor', label: 'Supervisor' },
]

const WORKER_NAME_KEY = 'stepwise-worker'
const readName = () => {
  try {
    return localStorage.getItem(WORKER_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Brand: small app icon + lowercase wordmark. No colored chip. */
export function SiteBrand() {
  return (
    <Link to="/" className="sh-brand" aria-label={`${BRAND} home`}>
      <AppIcon size={24} />
      <span className="sh-word">{BRAND}</span>
    </Link>
  )
}

/**
 * Global header, same on every page (spec §2).
 * mode: 'full' (default) | 'brand' (brand only, e.g. buddy phone) | 'focus' (brand + `title`, nav hidden; worker running).
 */
export function SiteHeader({ mode = 'full', title }: { mode?: 'full' | 'brand' | 'focus'; title?: string }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const brandOnly = mode === 'brand' || pathname.startsWith('/buddy')
  const inWorker = pathname.startsWith('/worker')
  const inSupervisor = pathname.startsWith('/supervisor')
  const name = inWorker ? readName() : ''

  const cta = inWorker ? (
    name ? (
      <Link to="/worker" className="sh-chip" onClick={() => { try { localStorage.removeItem(WORKER_NAME_KEY) } catch { /* ignore */ } }} title={`Not ${name}? Change name`}>
        {name} <span className="sh-chip-sub">· change</span>
      </Link>
    ) : null
  ) : inSupervisor ? (
    <Link to="/buddy" className="btn-outline sh-cta">Open buddy phone</Link>
  ) : (
    <Link to="/choose" className="btn btn-primary sh-cta">Open {BRAND}</Link>
  )

  return (
    <header className="site-header">
      <div className="sh-inner">
        <SiteBrand />
        {mode === 'focus' && title && <span className="sh-title">{title}</span>}
        {(brandOnly || mode === 'focus') && (
          <div className="sh-right">
            <ThemeToggle />
          </div>
        )}
        {!brandOnly && mode !== 'focus' && (
          <>
            <nav className={`sh-nav${open ? ' open' : ''}`} aria-label="Main">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="sh-right">
              {cta}
              <ThemeToggle />
              <button type="button" className="sh-menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? 'Close' : 'Menu'}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
