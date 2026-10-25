import { apiUrl } from '../../lib/audio'
import { CorrectionBubble } from './CorrectionBubble'

/**
 * GlassesMock({ photo?, step, total, instruction, correction?, name, sample? })
 * What the worker sees through the glasses: framed photo (API-relative or absolute URL), "STEP n OF m" HUD,
 * instruction, and an optional correction bubble in the coach's voice. step is 1-based. sample adds a "Sample" label.
 */
export function GlassesMock({
  photo,
  step,
  total,
  instruction,
  correction,
  name,
  sample = false,
}: {
  photo?: string
  step: number
  total: number
  instruction: string
  correction?: string
  name: string
  sample?: boolean
}) {
  const src = photo ? (/^(https?:|data:|blob:)/.test(photo) || photo.startsWith('/src') ? photo : apiUrl(photo)) : undefined
  return (
    <div className="gmock">
      <div className="gm-view">
        {src ? <img className="gm-photo" src={src} alt="" /> : <div className="gm-photo gm-empty" />}
        <div className="gm-shade" aria-hidden />
        <div className="gm-hud">
          <span className="gm-step">STEP {step} OF {total}</span>
          {sample && <span className="gm-sample">Sample</span>}
        </div>
        <p className="gm-instr">{instruction}</p>
      </div>
      {correction && (
        <div className="gm-say">
          <CorrectionBubble name={name} text={correction} speaking />
        </div>
      )}
    </div>
  )
}
