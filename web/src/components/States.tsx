import type { ReactNode } from 'react'

const Icon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <ellipse cx="7" cy="17" rx="4" ry="2.5" />
    <ellipse cx="13" cy="12" rx="3.2" ry="2" />
    <ellipse cx="18.5" cy="7" rx="2.6" ry="1.7" />
  </svg>
)

/** EmptyState({ title, text?, action? }) — line icon, h3, one sentence, optional action node. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state-empty card">
      <span className="state-icon"><Icon /></span>
      <h3>{title}</h3>
      {text && <p className="caption">{text}</p>}
      {action}
    </div>
  )
}
/** Alias kept for the name in the task brief. */
export const Empty = EmptyState

/** Loading({ lines = 3, label = 'Loading' }) — shimmer skeleton blocks (static under reduced motion). */
export function Loading({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="state-loading" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel" style={{ width: `${100 - i * 18}%` }} />
      ))}
    </div>
  )
}

/** ErrorNote({ text?, onRetry?, urgent? }) — Almost-tone card; Sol rule only when a person must act. */
export function ErrorNote({ text = "We couldn't reach the coach server. Try again.", onRetry, urgent = false }: { text?: string; onRetry?: () => void; urgent?: boolean }) {
  return (
    <div className={`state-error card${urgent ? ' urgent' : ''}`} role="alert">
      <p>{text}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
export const ErrorState = ErrorNote
