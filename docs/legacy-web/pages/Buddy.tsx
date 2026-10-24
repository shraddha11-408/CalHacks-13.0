import { useState } from 'react'
import { HelpRequestCard } from '../components/cards'
import { Simulated } from '../components/ui'
import { BUDDY, HELP_REQUESTS } from '../mock'
import type { HelpRequest } from '../types'

export function BuddyPage() {
  const [reqs, setReqs] = useState<HelpRequest[]>(HELP_REQUESTS.filter((r) => r.routed_to === 'buddy'))
  const [notes, setNotes] = useState<Record<string, string>>({})

  const claim = (id: string) => setReqs((r) => r.map((x) => (x.id === id ? { ...x, status: 'claimed', claimed_by: 'you' } : x)))
  const resolve = (id: string) => setReqs((r) => r.map((x) => (x.id === id ? { ...x, status: 'resolved' } : x)))

  const open = reqs.filter((r) => r.status !== 'resolved')
  return (
    <div className="phone stack" style={{ gap: 16 }}>
      <div className="spread">
        <div>
          <h1>Hi, {BUDDY.name}</h1>
          <p className="muted">{open.length ? `${open.length} coworker${open.length > 1 ? 's' : ''} could use a hand.` : 'Nobody needs help right now.'}</p>
        </div>
        <Simulated />
      </div>
      {reqs.map((r) => (
        <HelpRequestCard
          key={r.id}
          req={r}
          big
          onClaim={() => claim(r.id)}
          footer={
            r.status === 'claimed' && r.claimed_by === 'you' ? (
              <div className="stack" style={{ gap: 8 }}>
                <label htmlFor={`note-${r.id}`} className="small">
                  What helped? (short note for the coach)
                </label>
                <textarea
                  id={`note-${r.id}`}
                  className="search"
                  placeholder="Showed how to fold it in half."
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                />
                <button className="btn btn-primary btn-xl btn-block" onClick={() => resolve(r.id)}>
                  Done helping
                </button>
              </div>
            ) : r.status === 'claimed' ? (
              <p className="small muted">Someone else is helping. Thanks for checking.</p>
            ) : r.status === 'resolved' ? (
              <p className="small" role="status">
                Thanks! {notes[r.id] ? `Note saved: “${notes[r.id]}”` : 'Marked as helped.'}
              </p>
            ) : null
          }
        />
      ))}
    </div>
  )
}
