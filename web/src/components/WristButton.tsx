import { useCallback, useEffect, useRef, useState } from 'react'
import '../styles/wrist.css'

type Phase = 'idle' | 'sending' | 'called' | 'error'

/** On-screen stand-in for the wristband. One press calls the supervisor (no buddy stage). */
export function WristButton({ sessionId, workerName, onCalled }: { sessionId: string | null; workerName?: string; onCalled?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const busy = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const press = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setPhase('sending')
    try {
      const r = await fetch('/api/wrist/press', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
      })
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: { url?: string | null }[] }
      if (!r.ok || data.ok === false) throw new Error('not sent')
      setPhase('called')
      const url = data.say?.[0]?.url
      if (url) new Audio(url.startsWith('/api') ? url : `/api${url}`).play().catch(() => {})
      onCalled?.()
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setPhase('idle'), 12000)
    } catch {
      setPhase('error')
      setMsg('It did not work. Press again.')
    } finally {
      busy.current = false
    }
  }, [sessionId, onCalled])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if ((e.key === 'w' || e.key === 'W') && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA') void press()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const state = phase === 'sending' ? 'Calling your supervisor…' : phase === 'called' ? 'Your supervisor is coming.' : phase === 'error' ? msg : ''
  return (
    <div className="wr-wrap">
      <div className="wr-band">
        <button
          type="button"
          className="wr-btn"
          onClick={() => void press()}
          disabled={phase === 'sending'}
          aria-label={`Press to call your supervisor${workerName ? `, ${workerName}` : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
          </svg>
        </button>
      </div>
      <p className="wr-label">Press to call your supervisor</p>
      <p className={`wr-state ${phase === 'called' ? 'on' : ''} ${phase === 'error' ? 'wr-err' : ''}`} role="status" aria-live="polite">
        {state}
      </p>
    </div>
  )
}
