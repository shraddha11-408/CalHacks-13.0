import type { SupportLevel, Tier } from './types'

export const TIER_LABEL: Record<Tier, string> = {
  bitdeer: 'Bitdeer',
  gemini: 'Gemini Flash',
  haiku: 'Claude Haiku',
  sonnet: 'Claude Sonnet',
  claude: 'Claude',
  moss: 'Moss memory',
  cartesia: 'Cartesia',
  instant: 'Instant',
  button: 'Button',
  system: 'Moved on',
  checker: 'Checker',
  static: 'Static',
}

export const asTier = (s: string): Tier => (s in TIER_LABEL ? (s as Tier) : 'static')

export const LEVEL_NAME: Record<SupportLevel, string> = { 0: 'Full', 1: 'Cue', 2: 'Alerts', 3: 'Independent' }

export function fmtLatency(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function fmtUsd(v: number): string {
  if (v === 0) return '$0'
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`
}
