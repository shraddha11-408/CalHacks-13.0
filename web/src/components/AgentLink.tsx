import { useEffect, useRef, type MutableRefObject } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { reducers, tables } from '../module_bindings'
import type { AgentTurn, ToolRun } from '../lib/agent'

/** What the worker page calls to put the conversation in SpacetimeDB (no-ops when the database is down). */
export interface AgentLog {
  start: (a: { callId: string; sessionId: string; taskId: string; agentVersion: string; voice: string }) => void
  turn: (callId: string, t: AgentTurn) => void
  tool: (callId: string, t: ToolRun) => void
  end: (callId: string, reason: string) => void
}

/**
 * Lives inside StdbGate on the worker page. The voice itself goes straight to Cartesia; this only
 * writes the call, its turns and its tool calls through reducers (fire and forget, after the fact),
 * and watches the call's row: when the job coach ends the call from the floor, the screen hangs up.
 */
export function AgentLink({ logRef, callId, onCoachEnded }: { logRef: MutableRefObject<AgentLog | null>; callId: string; onCoachEnded: (by: string) => void }) {
  const start = useReducer(reducers.agentCallStart)
  const turn = useReducer(reducers.agentTurnLog)
  const tool = useReducer(reducers.agentToolLog)
  const end = useReducer(reducers.agentCallEnd)
  useEffect(() => {
    const quiet = (p: Promise<unknown>) => void p.catch(() => {})
    logRef.current = {
      start: (a) => quiet(start(a)),
      turn: (id, t) => quiet(turn({ callId: id, turn: t.turn, role: t.role, text: t.text, interrupted: t.interrupted, responseMs: t.responseMs })),
      tool: (id, t) => quiet(tool({ callId: id, toolCallId: t.toolCallId, tool: t.name, argsJson: JSON.stringify(t.params), result: t.result, ok: t.ok, latencyMs: t.ms })),
      end: (id, reason) => quiet(end({ callId: id, reason })),
    }
    return () => {
      logRef.current = null
    }
  }, [logRef, start, turn, tool, end])

  const ended = useRef(onCoachEnded)
  useEffect(() => {
    ended.current = onCoachEnded
  }, [onCoachEnded])
  const [calls] = useTable(tables.agentCall)
  const mine = callId ? calls.find((c) => c.callId === callId) : undefined
  useEffect(() => {
    if (mine && mine.status === 'ended' && mine.endReason.startsWith('coach:')) ended.current(mine.endReason.slice(6))
  }, [mine])
  return null
}
