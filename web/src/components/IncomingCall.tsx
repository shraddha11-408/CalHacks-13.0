import { useEffect, useRef, useState } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { apiUrl } from '../lib/audio'
import { reducers, tables } from '../module_bindings'
import '../styles/wrist.css'

/** Supervisor side: a ringing card for each unanswered wristband call. Stacks, dismissible, never blocks the page. */
export function IncomingCall() {
  const [calls] = useTable(tables.wristCall)
  const [help] = useTable(tables.helpRequest)
  const [workers] = useTable(tables.worker)
  const [tasks] = useTable(tables.task)
  const claim = useReducer(reducers.claimHelp)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const mountedAt = useRef(Date.now())
  const chimed = useRef<Set<string>>(new Set())
  const ctx = useRef<AudioContext | null>(null)

  // WebAudio only starts after a user gesture; arm it on the first interaction with the page.
  useEffect(() => {
    const arm = () => {
      try {
        ctx.current ??= new AudioContext()
        void ctx.current.resume()
      } catch {
        /* no audio */
      }
    }
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  const open = calls
    .filter((c) => !c.answeredAt && !dismissed.has(String(c.id)))
    .sort((a, b) => Number(b.id - a.id))

  useEffect(() => {
    for (const c of open) {
      const key = String(c.id)
      if (chimed.current.has(key)) continue
      chimed.current.add(key)
      const a = ctx.current
      if (!a || a.state !== 'running' || Number(c.createdAt.microsSinceUnixEpoch / 1000n) < mountedAt.current - 2000) continue
      const o = a.createOscillator()
      const g = a.createGain()
      o.type = 'sine'
      o.frequency.value = 660
      g.gain.setValueAtTime(0.0001, a.currentTime)
      g.gain.exponentialRampToValueAtTime(0.08, a.currentTime + 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.7)
      o.connect(g).connect(a.destination)
      o.start()
      o.stop(a.currentTime + 0.75)
    }
  }, [open])

  if (!open.length) return null
  const nameOf = (id: string) => workers.find((w) => w.id === id)?.name ?? id
  const stepText = (taskId: string, stepId: number) => {
    try {
      const steps = JSON.parse(tasks.find((t) => t.id === taskId)?.stepsJson ?? '[]') as { id: number; instruction: string }[]
      const i = steps.findIndex((s) => s.id === stepId)
      return i >= 0 ? `Step ${i + 1}: ${steps[i].instruction}` : ''
    } catch {
      return ''
    }
  }

  return (
    <div className="ic-stack" role="region" aria-label="Wristband calls">
      {open.map((c) => {
        const h = help.find((x) => x.id === c.helpId)
        const step = h ? stepText(h.taskId, h.stepId) : ''
        const dismiss = () => setDismissed((d) => new Set(d).add(String(c.id)))
        return (
          <div key={String(c.id)} className="ic-card" role="alert">
            <span className="ic-ring" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
              </svg>
            </span>
            <div>
              <p className="ic-title">{nameOf(c.workerId)} is calling from the wristband</p>
              {step && <p className="ic-sub">{step}</p>}
            </div>
            <button type="button" className="ic-x" onClick={dismiss} aria-label="Dismiss">
              ×
            </button>
            {h?.photo && <img src={apiUrl(h.photo)} alt={`What ${nameOf(c.workerId)} sees`} />}
            <div className="ic-actions">
              <button type="button" className="ic-btn primary" onClick={() => claim({ id: c.helpId, by: 'Supervisor' }).catch(() => {})}>
                I'm coming
              </button>
              <a className="ic-btn" href="/supervisor?tab=help" onClick={dismiss}>
                Open help
              </a>
            </div>
          </div>
        )
      })}
    </div>
  )
}
