// Shared UI types for the MVP (PLAN.md). Data shapes from the edge API live in lib/api.ts;
// SpacetimeDB row types come from module_bindings.

/** Who decided / answered. */
export type Tier = 'bitdeer' | 'claude' | 'moss' | 'cartesia' | 'instant' | 'button' | 'system' | 'checker' | 'static'
export type VerdictStatus = 'done' | 'confirming' | 'finished' | 'mistake' | 'in_progress' | 'unclear' | 'skipped' | 'help' | 'unavailable'
export type SupportLevel = 0 | 1 | 2 | 3
export type HealthState = 'ok' | 'degraded' | 'down' | 'off'

export interface StreamEvent {
  ts: string
  worker: string
  text: string
  tier?: Tier
  latency_ms?: number
  status?: VerdictStatus
}

export interface CompileEvent {
  ts: string
  kind: 'plan' | 'tool' | 'diff' | 'pass' | 'fail'
  text: string
}
