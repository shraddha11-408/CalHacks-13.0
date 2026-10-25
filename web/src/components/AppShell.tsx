import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './Brand'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** Header brand (kept as `Logo` for older imports). */
export function Logo() {
  return <BrandMark />
}

/**
 * Frame for every product page: shared SiteHeader, optional back link + title, optional footer.
 * header: SiteHeader mode ('full' | 'brand' | 'focus'); headerTitle shows in focus mode.
 */
export function AppShell({
  back,
  title,
  children,
  footer = false,
  header = 'full',
  headerTitle,
}: {
  back?: { to: string; label: string }
  title?: string
  children: ReactNode
  footer?: boolean
  header?: 'full' | 'brand' | 'focus'
  headerTitle?: string
}) {
  return (
    <div className="app">
      <SiteHeader mode={header} title={headerTitle} />
      <main className="app-main" id="main">
        {back && (
          <Link to={back.to} className="btn-ghost shell-back">
            ← {back.label}
          </Link>
        )}
        {title && <h1 className="app-title">{title}</h1>}
        {children}
      </main>
      {footer && <SiteFooter />}
    </div>
  )
}
