// Fading support levels (AGENTS.md §10). SpacetimeDB's mastery table is the authority.
export const LEVELS = [
  { name: 'Full help', worker: 'Learning', says: 'Full instruction, praise, hints' },
  { name: 'Short cue', worker: 'Short reminders', says: 'A 2–4 word reminder' },
  { name: 'Alerts only', worker: 'Only if needed', says: 'Silent unless something needs fixing' },
  { name: 'Independent', worker: 'On your own', says: 'Silent; offers help if stuck a long time' },
] as const

export const levelOf = (n: number) => LEVELS[Math.max(0, Math.min(3, n))]
