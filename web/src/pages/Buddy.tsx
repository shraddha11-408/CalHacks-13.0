import { useEffect, useState } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { AppShell } from '../components/AppShell'
import { StdbGate } from '../components/Stdb'
import { apiUrl } from '../lib/audio'
import { reducers, tables } from '../module_bindings'
import { RaceLog } from '../components/RaceLog'
import { useRegisterDevice } from '../lib/device'
import { doubleClaims } from '../lib/claims'
import '../styles/buddy.css'

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
    <AppShell header="brand">
      {!name ? (
        <form
          className="name-gate bd-gate"
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
          <h1 className="bd-gate-h1">Be a help buddy</h1>
          <p className="bd-gate-sub">We'll ping you when a coworker needs a hand.</p>
          <label htmlFor="buddy-name" className="bd-gate-label">
            Your name
          </label>
          <input id="buddy-name" className="field bd-field" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your name" />
          <button className="btn btn-primary bd-btn" disabled={!draft.trim()}>
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
  const [helpAll] = useTable(tables.helpRequest)
  const [routes] = useTable(tables.helpRoute)
  // a wristband short touch is a quiet note for the supervisor only, never a buddy alert
  const help = helpAll.filter((h) => routes.find((r) => r.helpId === h.id)?.routedTo !== 'notice')
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
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const shown = recent.filter((h) => !skipped.has(String(h.id)))
  // the loud screen: the newest open request; otherwise the newest claimed one (race result)
  const h = shown.find((x) => x.status === 'open') ?? shown[0]
  const skip = (id: bigint) => setSkipped((s) => new Set(s).add(String(id)))

  return (
    <div className="bd-wrap">
      <div className="bd-frame">
        <section className="bd-screen water on-rio" aria-live="polite">
          <div className="bd-top">
            <p className="eyebrow">DRIGIL · BUDDY PHONE</p>
            <button className="bd-who" onClick={onChangeName}>
              Not {name}?
            </button>
          </div>
          {error && <p className="bd-note">{error}</p>}
          {!h ? (
            <div className="bd-idle">
              <span className="bd-ripple" aria-hidden>
                <span /><span /><span />
              </span>
              <h1 className="bd-h1">No one needs a hand right now.</h1>
              <p className="bd-ctx">You're on the list, {name}. Keep this page open. When a coworker asks for help, it shows up here.</p>
            </div>
          ) : (
            (() => {
              const mine = attempts.filter((a) => a.helpId === h.id)
              const myTry = [...mine].reverse().find((a) => a.by === name)
              const step = stepText(h.taskId, h.stepId)
              const nm = who(h.workerId)
              return (
                <>
                  {h.photo && <img className="bd-photo" src={apiUrl(h.photo)} alt={`What ${nm} sees`} />}
                  <h1 className="bd-h1">{nm} needs a hand.</h1>
                  <p className="bd-ctx">
                    Step {h.stepId}
                    {step ? `: ${step.replace(/\.$/, '')}` : ''}. You are the first one asked.
                  </p>
                  {h.status === 'open' ? (
                    <div className="bd-actions">
                      <button className="btn-sol bd-btn" onClick={() => claim({ id: h.id, by: name }).catch(() => {})}>
                        I'll help
                      </button>
                      <button className="btn-outline bd-btn" onClick={() => skip(h.id)}>
                        Not right now
                      </button>
                    </div>
                  ) : (
                    <div className="bd-confirm">
                      <p>{myTry?.won || h.claimedBy === name ? `You're on it. Go to ${nm}.` : `${h.claimedBy} is already going. Thank you!`}</p>
                      <button className="btn-outline bd-btn" onClick={() => skip(h.id)}>
                        OK
                      </button>
                    </div>
                  )}
                  <div className="bd-race">
                    <RaceLog attempts={mine} me={name} />
                  </div>
                </>
              )
            })()
          )}
          <p className="bd-dc num">Claim race · double-claims {dc}</p>
        </section>
      </div>
    </div>
  )
}
