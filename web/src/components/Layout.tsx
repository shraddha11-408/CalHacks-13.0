import { NavLink, Outlet } from 'react-router-dom'
import { BrandMark } from './Brand'
import { SiteHeader } from './SiteHeader'

const NAV = [
  { to: '/lab', label: 'Live floor', end: true },
  { to: '/video', label: 'Video breakdown' },
  { to: '/teach', label: 'Teach' },
  { to: '/coach', label: 'Coach' },
  { to: '/steps', label: 'Worker steps' },
  { to: '/health', label: 'Health' },
]

/** Header brand for the lab pages (kept as `Brand` for older imports). */
export function Brand() {
  return <BrandMark size={22} />
}

/** Lab pages: shared SiteHeader + a quiet lab sub-nav. */
export function Layout() {
  return (
    <div className="shell">
      <SiteHeader />
      <nav className="lab-nav" aria-label="Lab">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  )
}

/** Header only (for full-screen pages like /steps). */
export function HeaderOnly() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  )
}
