import { useEffect, useState } from 'react'
import { StepCard } from '../components/cards'
import { Tray } from '../components/Tray'
import { Panel } from '../components/ui'
import { KEYFRAMES, TASK, TEACH_TRANSCRIPT } from '../mock'

type Phase = 'idle' | 'teaching' | 'review' | 'published'

export function TeachPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState(0)
  const [fixing, setFixing] = useState<number | null>(null)

  // Scripted transcript while "teaching". Replaced by live STT later.
  useEffect(() => {
    if (phase !== 'teaching') return
    const id = setInterval(() => setLines((n) => Math.min(n + 1, TEACH_TRANSCRIPT.length)), 1100)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => {
    if (fixing === null) return
    const t = setTimeout(() => setFixing(null), 2600)
    return () => clearTimeout(t)
  }, [fixing])

  const shownLines = phase === 'idle' ? [] : phase === 'teaching' ? TEACH_TRANSCRIPT.slice(0, lines) : TEACH_TRANSCRIPT
  const shownFrames = phase === 'idle' ? [] : phase === 'teaching' ? KEYFRAMES.slice(0, Math.floor((lines / TEACH_TRANSCRIPT.length) * KEYFRAMES.length)) : KEYFRAMES
  const checkable = TASK.steps.filter((s) => s.checkable_by_rule).length

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Teach a task</h1>
          <p className="muted">Do the task once and talk while you do it. You can do one step wrong on purpose and say “this is wrong.”</p>
        </div>
        <div className="row">
          {phase === 'teaching' ? (
            <button className="btn btn-xl btn-urgent" onClick={() => setPhase('review')}>
              <span className="rec-dot" aria-hidden /> Stop teaching
            </button>
          ) : (
            <button
              className="btn btn-xl btn-primary"
              onClick={() => {
                setLines(0)
                setPhase('teaching')
              }}
            >
              {phase === 'idle' ? 'Start teaching' : 'Teach again'}
            </button>
          )}
        </div>
      </div>

      <div className="two-col">
        <Panel title="Live transcript" simulated>
          {shownLines.length ? (
            <ul className="transcript" aria-live="polite">
              {shownLines.map((l) => (
                <li key={l.t}>
                  <span className="muted num small">{l.t}</span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Press Start teaching. Your words will show here.</p>
          )}
        </Panel>
        <Panel title="Keyframes" simulated actions={<span className="small muted">Picked when the tray settles</span>}>
          {shownFrames.length ? (
            <div className="keyframes">
              {shownFrames.map((k) => (
                <figure key={k.t} className={`keyframe ${k.mistake ? 'mistake' : ''}`}>
                  <Tray tray={k.tray} onDone={k.label.includes('done')} />
                  <figcaption>
                    <span className="num muted">{k.t}</span> {k.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">No frames yet.</p>
          )}
        </Panel>
      </div>

      {(phase === 'review' || phase === 'published') && (
        <Panel
          title={TASK.title}
          simulated
          actions={
            phase === 'published' ? (
              <span className="badge-claimed" role="status">
                Published · {checkable} compile jobs · indexed in Moss
              </span>
            ) : (
              <button className="btn btn-primary" onClick={() => setPhase('published')}>
                Publish
              </button>
            )
          }
        >
          <p className="muted small" style={{ marginBottom: 12 }}>
            Steps written by Claude from your demo. Fix any step by voice; the edit goes back through Claude.
          </p>
          <div className="stack">
            {TASK.steps.map((s, i) => (
              <StepCard
                key={s.id}
                step={s}
                index={i}
                actions={
                  <button className="btn btn-secondary" onClick={() => setFixing(i)} aria-pressed={fixing === i}>
                    🎙 {fixing === i ? 'Listening… “step 3 is the lotion”' : 'Fix by voice'}
                  </button>
                }
              />
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
