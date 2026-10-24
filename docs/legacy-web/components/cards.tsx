import type { ReactNode } from 'react'
import { TASK, TRAY_AFTER } from '../mock'
import type { HelpRequest, Step, Worker } from '../types'
import { Tray } from './Tray'
import { LevelMeter, TierBadge, VerdictPill } from './ui'

export function WorkerCard({ worker, onOpen }: { worker: Worker; onOpen?: () => void }) {
  const step = TASK.steps[worker.step_index]
  const v = worker.last_verdict
  return (
    <article className={`panel worker-card ${worker.help === 'open' ? 'help' : ''}`} aria-label={`${worker.name}, ${step.instruction.cue}`}>
      <div className="spread">
        <div className="row">
          <div className="avatar" aria-hidden>
            {worker.name[0]}
          </div>
          <div>
            <h3>{worker.name}</h3>
            <div className="small muted">{worker.online ? 'On shift' : 'Offline'}</div>
          </div>
        </div>
        {worker.help === 'open' && <span className="badge-urgent">Needs help</span>}
        {worker.help === 'claimed' && <span className="badge-claimed">Help coming</span>}
      </div>
      <div className="progress" aria-hidden>
        {TASK.steps.map((s, i) => (
          <span key={s.id} className={i < worker.step_index ? 'done' : i === worker.step_index ? 'now' : ''} />
        ))}
      </div>
      <dl className="kv">
        <dt>Step</dt>
        <dd>
          <strong>
            {worker.step_index + 1}. {step.instruction.cue}
          </strong>
        </dd>
        <dt>Support</dt>
        <dd>
          <LevelMeter level={worker.support_level} />
        </dd>
        <dt>Last check</dt>
        <dd className="row" style={{ gap: 6 }}>
          {v ? (
            <>
              <VerdictPill status={v.status} />
              <TierBadge tier={v.tier} latency_ms={v.latency_ms} />
            </>
          ) : (
            <span className="muted">No checks yet</span>
          )}
        </dd>
      </dl>
      {onOpen && (
        <button className="btn btn-secondary" onClick={onOpen}>
          Open worker view
        </button>
      )}
    </article>
  )
}

export function StepCard({ step, index, actions, note }: { step: Step; index: number; actions?: ReactNode; note?: ReactNode }) {
  return (
    <article className="panel step-card">
      <div className="tray-thumb">
        <Tray tray={TRAY_AFTER[index + 1]} highlight={step.region} label={`Picture card for step ${index + 1}`} />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <span className="step-num">{index + 1}</span>
          <h3>{step.instruction.full}</h3>
        </div>
        <div className="small">
          <span className="muted">Cue:</span> “{step.instruction.cue}”
        </div>
        <div className="small">
          <span className="muted">Done when:</span> {step.success}
        </div>
        {step.common_errors.map((e) => (
          <div key={e.type} className="small">
            <span className="muted">If {e.type.replace('_', ' ')}:</span> “{e.correction}”
          </div>
        ))}
        <div className="row">
          {step.checkable_by_rule ? (
            <span className="tier tier-checker">Checker can verify</span>
          ) : (
            <span className="tier tier-bitdeer">Model check (no rule)</span>
          )}
          {note}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </article>
  )
}

export function HelpRequestCard({
  req,
  onClaim,
  big = false,
  footer,
}: {
  req: HelpRequest
  onClaim?: () => void
  big?: boolean
  footer?: ReactNode
}) {
  return (
    <article className="panel help-card" aria-label={`Help request from ${req.worker_name}`}>
      <div className="tray-thumb">
        <Tray tray={req.tray} label={`Tray photo from ${req.worker_name}`} />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="spread">
          <h3>{req.worker_name} needs help</h3>
          {req.status === 'open' ? (
            <span className="badge-urgent num">{req.opened_s_ago}s waiting</span>
          ) : req.status === 'claimed' ? (
            <span className="badge-claimed">Claimed by {req.claimed_by}</span>
          ) : (
            <span className="badge-soft">Resolved</span>
          )}
        </div>
        <div className="small">
          Step: <strong>{req.step_label}</strong> · sent to {req.routed_to === 'buddy' ? 'buddy' : 'supervisor'}
        </div>
        {req.status === 'open' && onClaim && (
          <button className={`btn btn-primary ${big ? 'btn-xl btn-block' : ''}`} onClick={onClaim}>
            Claim
          </button>
        )}
        {footer}
      </div>
    </article>
  )
}
