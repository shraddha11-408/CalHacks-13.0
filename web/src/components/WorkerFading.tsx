import { useEffect, useRef } from 'react'
import { useTable } from 'spacetimedb/react'
import { useRegisterDevice } from '../lib/device'
import { tables } from '../module_bindings'

export interface LevelChangeEvent {
  stepId: number
  from: number
  to: number
  reason: string
  by: string
}

/**
 * Lives inside StdbGate on the worker page. Registers this screen as the worker's device, mirrors the
 * worker's support levels through the per-identity `my_mastery` view, and hears `level_change` events
 * the moment SpacetimeDB's fading rules (or the job coach) change a level.
 */
export function WorkerFading({
  workerId,
  workerName,
  taskId,
  onLevels,
  onLevelChange,
}: {
  workerId: string
  workerName: string
  taskId: string
  onLevels: (levels: Record<number, number>) => void
  onLevelChange: (e: LevelChangeEvent) => void
}) {
  useRegisterDevice('worker_screen', `${workerName}'s screen`, workerId)
  const [rows] = useTable(tables.myMastery)
  useEffect(() => {
    const m: Record<number, number> = {}
    for (const r of rows) if (r.taskId === taskId) m[r.stepId] = r.level
    onLevels(m)
  }, [rows, taskId, onLevels])

  const changed = useRef(onLevelChange)
  useEffect(() => {
    changed.current = onLevelChange
  }, [onLevelChange])
  useTable(tables.levelChange, {
    onInsert: (r) => {
      if (r.workerId === workerId && r.taskId === taskId) changed.current({ stepId: r.stepId, from: r.fromLevel, to: r.toLevel, reason: r.reason, by: r.by })
    },
  })
  return null
}
