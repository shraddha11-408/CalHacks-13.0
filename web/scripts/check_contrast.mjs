// WCAG AA check for every text/background token pair, in light and dark.
// Usage: node scripts/check_contrast.mjs   (exits 1 on any failure)
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const block = (re) => Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
const light = block(/^:root \{([\s\S]*?)\n\}/m)
const dark = { ...light, ...block(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/) }

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// [text, background, min ratio]  4.5 = normal text, 3 = large text / UI
const pairs = [
  ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink', 'surface-2', 4.5],
  ['ink-2', 'bg', 4.5], ['ink-2', 'surface', 4.5], ['ink-2', 'surface-2', 4.5],
  ['primary', 'surface', 4.5], ['primary', 'bg', 4.5], ['on-primary', 'primary', 4.5],
  ['primary-soft-ink', 'primary-soft', 4.5],
  ['success', 'success-bg', 4.5], ['success', 'surface', 4.5],
  ['almost', 'almost-bg', 4.5], ['almost', 'surface', 4.5],
  ['urgent', 'urgent-bg', 4.5], ['urgent', 'surface', 4.5], ['on-urgent', 'urgent-fill', 4.5],
  ['tier-checker', 'tier-checker-bg', 4.5], ['tier-bitdeer', 'tier-bitdeer-bg', 4.5],
  ['tier-claude', 'tier-claude-bg', 4.5], ['tier-moss', 'tier-moss-bg', 4.5],
  ['sim-ink', 'sim-bg', 4.5], ['idle', 'surface', 3], ['focus', 'bg', 3],
]
let fail = 0
for (const [name, t] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg])
    const ok = r >= min
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(5)} ${fg.padEnd(16)} on ${bg.padEnd(15)} ${r.toFixed(2)} (min ${min})`)
  }
}
process.exit(fail ? 1 : 0)
