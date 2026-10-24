import { useState } from 'react'
import { ConsentBanner, Panel } from '../components/ui'
import { CONSENT, CONSENT_SCRIPT } from '../mock'

type Rec = 'idle' | 'recording' | 'done'

export function ConsentPage() {
  const [statement, setStatement] = useState<Rec>(CONSENT.statement_recorded ? 'done' : 'idle')
  const [sample, setSample] = useState<Rec>(CONSENT.sample_recorded ? 'done' : 'idle')
  const [voiceOn, setVoiceOn] = useState(CONSENT.worker_voice_on)
  const consented = statement === 'done'
  const clone = !consented ? 'blocked' : sample !== 'done' ? 'waiting' : CONSENT.clone_status

  const recBtn = (state: Rec, set: (r: Rec) => void, label: string, disabled = false) => (
    <button
      className={`btn ${state === 'recording' ? 'btn-urgent' : 'btn-primary'}`}
      disabled={disabled}
      onClick={() => set(state === 'recording' ? 'done' : 'recording')}
    >
      {state === 'recording' ? '■ Stop' : state === 'done' ? `↺ Record ${label} again` : `● Record ${label}`}
    </button>
  )

  const cloneWord: Record<string, string> = {
    blocked: 'Not allowed — no consent recorded',
    waiting: 'Waiting for voice sample',
    not_started: 'Not started',
    processing: 'Making the voice copy…',
    ready: 'Ready',
    failed: 'Failed — using the stock warm voice',
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 900 }}>
      <div className="page-head">
        <h1>Voice consent</h1>
        <p className="muted">No consent, no clone. Without consent the glasses use a stock warm voice.</p>
      </div>
      <ConsentBanner
        ok={consented}
        who={CONSENT.person}
        detail={consented ? `Recorded ${CONSENT.statement_at}. ${CONSENT.used_for}.` : 'Record the consent statement first.'}
      />

      <Panel title="1. Consent statement" simulated>
        <div className="stack">
          <p className="small muted">Read this out loud:</p>
          <blockquote style={{ margin: 0, padding: '14px 18px', borderLeft: '4px solid var(--primary)', background: 'var(--surface-2)', borderRadius: 8, fontSize: 20 }}>
            {CONSENT_SCRIPT}
          </blockquote>
          <div className="row">
            {recBtn(statement, setStatement, 'statement')}
            {statement === 'done' && <span className="badge-claimed">Saved on this laptop</span>}
          </div>
        </div>
      </Panel>

      <Panel title="2. Voice sample" simulated>
        <div className="stack">
          <p className="small muted">Talk for about 30–60 seconds. Read a task out loud, like you would to a worker.</p>
          <div className="row">
            {recBtn(sample, setSample, 'sample', !consented)}
            {sample === 'done' && <span className="badge-soft num">{CONSENT.sample_seconds} s recorded</span>}
          </div>
        </div>
      </Panel>

      <Panel title="3. Voice copy" simulated>
        <div className="stack">
          <div className="row">
            <span className={`dot ${clone === 'ready' ? 'dot-ok' : clone === 'failed' || clone === 'blocked' ? 'dot-off' : 'dot-degraded'}`} aria-hidden />
            <strong>{cloneWord[clone]}</strong>
          </div>
          <p className="small muted">Used only for: {CONSENT.used_for}. Recordings stay in consent/ on this laptop and are never committed.</p>
          <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} style={{ width: 24, height: 24 }} />
            <span>
              <strong>Worker control:</strong> use the coach’s voice {voiceOn ? '(on)' : '(off — stock voice)'}
            </span>
          </label>
        </div>
      </Panel>
    </div>
  )
}
