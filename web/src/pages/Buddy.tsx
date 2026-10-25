import { useEffect, useState } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { AppShell } from '../components/AppShell'
import { StdbGate } from '../components/Stdb'
import { apiUrl } from '../lib/audio'
import { reducers, tables } from '../module_bindings'
import { RaceLog } from '../components/RaceLog'
import { useRegisterDevice } from '../lib/device'
import { doubleClaims } from '../lib/claims'

const NAME_KEY = 'idd-buddy-name'
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
/** /buddy — a coworker's phone. Help alerts arrive live; the first "I'm going" wins. */
export function BuddyPage() {
  const [name, setName] = useState(readName)
  const [draft, setDraft] = useState('')
  return (
    <AppShell back={{ to: '/choose', label: 'Back' }}>
      {!name ? (
        <form
          className="name-gate"
          onSubmit={(e) => {
            e.preventDefault()
            const n = draft.trim()
            if (!n) return
            try {
              localStorage.setItem(NAME_KEY, n)
            } catch {
              /* ok */
            }
            setName(n)
          }}
        >
          <label htmlFor="buddy-name" className="big-label">
            Your name (help buddy)
          </label>
          <input id="buddy-name" className="field field-xl" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your name" />
          <button className="btn btn-primary btn-xl" disabled={!draft.trim()}>
            Start getting alerts
          </button>
        </form>
      ) : (
        <StdbGate>{(err) => <BuddyAlerts name={name} error={err} onChangeName={() => setName('')} />}</StdbGate>
      )}
    </AppShell>
  )
}

function BuddyAlerts({ name, error, onChangeName }: { name: string; error: string | null; onChangeName: () => void }) {
  useRegisterDevice('buddy', name)
  const [help] = useTable(tables.helpRequest)
  const [attempts] = useTable(tables.claimAttempt)
  const [workers] = useTable(tables.worker)
  const [tasks] = useTable(tables.task)
  const claim = useReducer(reducers.claimHelp)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const who = (id: string) => workers.find((w) => w.id === id)?.name ?? id
  const stepText = (taskId: string, stepId: number) => {
    try {
      const steps = JSON.parse(tasks.find((t) => t.id === taskId)?.stepsJson ?? '[]') as { id: number; instruction: string }[]
      return steps.find((s) => s.id === stepId)?.instruction ?? ''
    } catch {
      return ''
    }
  }
  // live alerts: open ones, plus ones claimed in the last 10 minutes (so the race result stays visible)
  const recent = [...help]
    .filter((h) => h.status === 'open' || (h.status === 'claimed' && now - h.createdAt.toDate().getTime() < 600_000))
    .sort((a, b) => Number(b.id - a.id))
  const dc = doubleClaims(attempts)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <h1 className="app-title" style={{ margin: 0 }}>
          Help alerts
        </h1>
        <button className="btn btn-ghost" onClick={onChangeName}>
          Not {name}?
        </button>
      </div>
      <p className="small muted">
        You're a help buddy. When a coworker presses help, it shows up here. Tap “I'm going” — the first tap wins, and everyone sees who's going.{' '}
        <span className={`badge-soft num ${dc ? 'badge-urgent' : ''}`}>double-claims: {dc}</span>
      </p>
      {error && <p className="note-almost">{error}</p>}
      {recent.length === 0 && <div className="empty">No one needs help right now. Keep this page open.</div>}
      {recent.map((h) => {
        const mine = attempts.filter((a) => a.helpId === h.id)
        const myTry = [...mine].reverse().find((a) => a.by === name)
        return (
          <article key={String(h.id)} className={`alert ${h.status === 'open' ? 'alert-open' : ''}`}>
            {h.photo ? <img src={apiUrl(h.photo)} alt={`What ${who(h.workerId)} sees`} /> : <div className="alert-nophoto" aria-hidden />}
            <div className="stack" style={{ gap: 8, flex: 1 }}>
              <strong className="alert-title">{who(h.workerId)} needs help</strong>
              <span className="muted small">{stepText(h.taskId, h.stepId)}</span>
              {h.status === 'open' ? (
                <button className="btn btn-primary btn-xl btn-block" onClick={() => claim({ id: h.id, by: name }).catch(() => {})}>
                  I'm going
                </button>
              ) : myTry?.won ? (
                <p className="race-banner race-banner-won">You've got it! Go help {who(h.workerId)}.</p>
              ) : (
                <p className="race-banner">{h.claimedBy} is going. Thank you!</p>
              )}
              <RaceLog attempts={mine} me={name} />
            </div>
          </article>
        )
      })}
    </div>
  )
}
