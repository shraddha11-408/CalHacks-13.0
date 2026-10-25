import { apiUrl } from '../../lib/audio'
import { verbOf } from '../Brand'

export type TimelineStep = { id: number; instruction: string; photo?: string }

const shortLabel = (s: string) => s.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 4).join(' ')

/**
 * StepTimeline({ steps, current, finished?, orientation?, size? })
 * steps: {id, instruction, photo? (API-relative URL)}[]; current: 0-based index of the step happening now.
 * orientation 'horizontal' (default) | 'vertical'; size 'sm' 40 | 'md' 72 (default) | 'lg' 120 px thumbs.
 */
export function StepTimeline({
  steps,
  current,
  finished = false,
  orientation = 'horizontal',
  size = 'md',
}: {
  steps: TimelineStep[]
  current: number
  finished?: boolean
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <ol className={`tl tl-${orientation} tl-${size}`} aria-label={`${steps.length} steps`}>
      {steps.map((s, i) => {
        const state = finished || i < current ? 'done' : i === current ? 'now' : 'next'
        return (
          <li key={s.id} className="tl-item" data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="tl-thumb">
              {s.photo ? <img src={apiUrl(s.photo)} alt="" /> : <span className="tl-num">{i + 1}</span>}
              {state === 'done' && (
                <span className="tl-check" aria-hidden>
                  <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
            </span>
            <span className="tl-text">
              <span className="tl-n num">{i + 1}</span>
              <span className="tl-label" title={s.instruction}>{size === 'sm' ? verbOf(s.instruction) : shortLabel(s.instruction)}</span>
              {state === 'now' && <span className="tl-now">Now</span>}
              {state === 'done' && <span className="sr-only">Done</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
