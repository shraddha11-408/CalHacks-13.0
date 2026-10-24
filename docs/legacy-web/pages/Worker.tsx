import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { GateChip, HsvCalibrator, LiveRaw, LiveTray } from '../components/live'
import { Tray } from '../components/Tray'
import { CaptionBar, Simulated, StepDots, TierLamps } from '../components/ui'
import { useEdgeEvents, usePipelineStats, type EdgeEvent } from '../edge'
import { LEVEL_NAME } from '../format'
import { TASK, TRAY_AFTER, WORKERS } from '../mock'
import { useScriptedLoop } from '../scripted'
import type { SlotName, SupportLevel, Tier } from '../types'

interface Sample {
  lo: number[]
  hi: number[]
  rgb: number[]
}

export function WorkerStage({ name, level, compact = false }: { name: string; level: SupportLevel; compact?: boolean }) {
  const beat = useScriptedLoop() // instruction + tier: simulated until the cascade lands
  const stats = usePipelineStats()
  const live = stats !== null && !stats.camera_error
  const [help, setHelp] = useState<'idle' | 'sent' | 'claimed'>('idle')
  const [talking, setTalking] = useState(false)
  const [lookAtTrayAt, setLookAtTrayAt] = useState(0)
  const [lastCheck, setLastCheck] = useState<EdgeEvent | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [sample, setSample] = useState<Sample | null>(null)
  const [sampleErr, setSampleErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const onEvent = useCallback((e: EdgeEvent) => {
    if (e.type === 'look_at_tray') setLookAtTrayAt(e.ts * 1000)
    if (e.type === 'check_ready') setLastCheck(e)
  }, [])
  useEdgeEvents(onEvent)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (help !== 'sent') return
    const t = setTimeout(() => setHelp('claimed'), 3500)
    return () => clearTimeout(t)
  }, [help])

  const pick = async (x: number, y: number) => {
    setSampleErr(null)
    try {
      const r = await fetch('/api/calibrate/hsv/sample', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail ?? r.statusText)
      setSample(j)
    } catch (err) {
      setSample(null)
      setSampleErr(String((err as Error).message))
    }
  }

  const step = TASK.steps[beat.step_index]
  const instruction = level === 0 ? step.instruction.full : step.instruction.cue
  const lookAtTray = now - lookAtTrayAt < 3500
  const mockTray = beat.status === 'wrong' && beat.step_index === 2 ? { ...TRAY_AFTER[2], slot_D: 'lotion' as const } : TRAY_AFTER[beat.step_index]
  const almost: SlotName | undefined = beat.status === 'wrong' && beat.step_index === 2 ? 'slot_D' : undefined
  const caption = talking
    ? 'Listening…'
    : lookAtTray
      ? 'Look at the tray, please.'
      : help === 'sent'
        ? 'Help is coming. Sam got your message.'
        : help === 'claimed'
          ? 'Sam is on the way.'
          : beat.said

  return (
    <div className="stack" style={{ gap: compact ? 16 : 24 }}>
      <div className="spread">
        <StepDots total={TASK.steps.length} current={beat.step_index} />
        <Simulated note="Instruction, tier and voice are a scripted loop until the cascade is connected. The tray view is live." />
      </div>

      <div className="worker-stage">
        <div className="worker-instruction">
          <div className="muted" style={{ fontSize: 22, fontWeight: 700 }}>
            {name} · {LEVEL_NAME[level]} support
          </div>
          <p className="instruction-text">{lookAtTray ? 'Look at the tray, please.' : instruction}</p>
          {!lookAtTray && beat.status === 'wrong' && (
            <p className="almost-line" role="status">
              {beat.said}
            </p>
          )}
        </div>
        <figure className="picture-card">
          <Tray tray={TRAY_AFTER[beat.step_index + 1]} highlight={step.region} label={`Picture card: ${step.success}`} />
          <figcaption>Picture card</figcaption>
        </figure>
      </div>

      <div className="worker-lower">
        <figure className="panel rectified stack" style={{ gap: 10 }}>
          <div className="spread">
            {live ? <span className="live-label">Live tray</span> : <Simulated note="Edge camera offline: showing a drawing." />}
            {live && (
              <div className="row" style={{ gap: 4 }}>
                <button className="btn btn-ghost" aria-pressed={showRaw} onClick={() => setShowRaw((v) => !v)}>
                  {showRaw ? 'Tray view' : 'Camera view'}
                </button>
                <button
                  className="btn btn-ghost"
                  aria-pressed={calibrating}
                  onClick={() => {
                    setCalibrating((v) => !v)
                    setShowRaw(false)
                  }}
                >
                  🎯 Calibrate
                </button>
              </div>
            )}
          </div>
          {live ? showRaw ? <LiveRaw /> : <LiveTray calibrating={calibrating} onPick={pick} /> : <Tray tray={mockTray} almost={almost} highlight={almost ? undefined : step.region} label="Tray drawing" />}
          <figcaption className="small muted">
            {showRaw ? 'Camera view with markers and gate. Stays on this laptop.' : 'Rectified tray view · only this leaves the device'}
          </figcaption>
          {live && <GateChip stats={stats} />}
          {live && lastCheck && (
            <span className="small muted num">
              Last check #{String(lastCheck.n)} · {new Date(lastCheck.ts * 1000).toLocaleTimeString()}
            </span>
          )}
        </figure>
        <div className="stack" style={{ gap: 16 }}>
          {calibrating ? (
            <HsvCalibrator sample={sample} error={sampleErr} onDone={() => setCalibrating(false)} />
          ) : (
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Who decided this check
              </div>
              <TierLamps active={beat.tier as Tier} latency_ms={beat.latency_ms} />
            </div>
          )}
          <div className="row" style={{ gap: 16 }}>
            <button className={`btn btn-xl ${talking ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={talking} onClick={() => setTalking((t) => !t)}>
              🎙 {talking ? 'Listening' : 'Talk'}
            </button>
            <button className="btn btn-xl btn-urgent" onClick={() => setHelp('sent')} disabled={help !== 'idle'}>
              ✋ {help === 'idle' ? 'Help' : help === 'sent' ? 'Help sent' : 'Help coming'}
            </button>
          </div>
        </div>
      </div>

      <CaptionBar text={caption} speaking={!talking} />
    </div>
  )
}

export function WorkerPage() {
  const { id } = useParams()
  const w = WORKERS.find((x) => x.id === id) ?? WORKERS[0]
  return <WorkerStage name={w.name} level={w.support_level} />
}
