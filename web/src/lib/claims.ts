import type { ClaimAttempt } from '../module_bindings/types'

/** Help requests with more than one winning claim. SpacetimeDB reducers are transactions, so this stays 0. */
export function doubleClaims(attempts: readonly ClaimAttempt[]): number {
  const wins = new Map<bigint, number>()
  for (const a of attempts) if (a.won) wins.set(a.helpId, (wins.get(a.helpId) ?? 0) + 1)
  return [...wins.values()].filter((n) => n > 1).length
}
