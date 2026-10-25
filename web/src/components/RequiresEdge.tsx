// Product pages need the edge app (the coach's backend, on the laptop next to the glasses). On the hosted
// website (Vercel, static only) there is no edge app, so instead of errors these pages explain where the
// live demo runs. Locally (./run.sh) the check passes and the page renders as usual.
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from './AppShell'

const REPO = 'https://github.com/shraddha11-408/CalHacks-13.0'

type State = 'checking' | 'online' | 'offline'
let cached: State | null = null // one check per page load

async function edgeOnline(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(4000) })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false
    return Boolean((await r.json())?.ok)
  } catch {
    return false
  }
}

export function RequiresEdge({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(cached ?? 'checking')
  useEffect(() => {
    if (cached) return
    let alive = true
    void edgeOnline().then((ok) => {
      cached = ok ? 'online' : 'offline'
      if (alive) setState(cached)
    })
    return () => {
      alive = false
    }
  }, [])
  if (state === 'online') return <>{children}</>
  if (state === 'checking') return <AppShell><div className="re-wait" aria-busy="true" /></AppShell>
  return (
    <AppShell>
      <section className="re-card card" aria-labelledby="re-title">
        <p className="eyebrow">Live demo</p>
        <h1 id="re-title" className="re-title">The live coach runs on our glasses.</h1>
        <p className="re-text">
          This page needs the drigil edge app, which runs on the laptop next to the glasses: the camera, the
          supervisor's voice and the wristband all connect there. Come see it live at our table, or run it yourself
          from the repo.
        </p>
        <div className="re-actions">
          <Link to="/" className="btn btn-primary">See how it works</Link>
          <Link to="/why" className="btn-outline">Why it works</Link>
          <a href={REPO} className="btn-outline" target="_blank" rel="noreferrer">Run it from GitHub</a>
        </div>
      </section>
    </AppShell>
  )
}
