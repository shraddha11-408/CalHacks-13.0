import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export const THEME_KEY = 'drigil-theme'
const OLD_THEME_KEY = 'stepwise-theme'
export const THEME_ORDER: Theme[] = ['system', 'light', 'dark']

const isTheme = (t: string | null): t is 'light' | 'dark' => t === 'light' || t === 'dark'

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(OLD_THEME_KEY)
    return isTheme(t) ? t : 'system'
  } catch {
    return 'system'
  }
}

const THEME_COLOR = { light: '#ECE8E1', dark: '#0E1C1C' }

/** Put the chosen theme on <html>. 'system' removes data-theme so prefers-color-scheme decides. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    // the media-tagged pair handles 'system'; a forced theme overrides both
    const media = m.getAttribute('media')
    m.setAttribute('content', theme === 'system' && media ? (media.includes('dark') ? THEME_COLOR.dark : THEME_COLOR.light) : dark ? THEME_COLOR.dark : THEME_COLOR.light)
  })
}

// apply as early as the module loads (index.html's inline script already did it before paint)
if (typeof document !== 'undefined') applyTheme(readTheme())

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
      localStorage.removeItem(OLD_THEME_KEY)
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
  }, [theme])
  // follow the OS while on 'system' (theme-color meta only; CSS follows on its own)
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [theme])
  const cycle = () => setTheme((t) => THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length])
  return [theme, setTheme, cycle] as const
}
