// Copies MediaPipe's WASM runtime into public/ so the coach loop works offline (not committed: ~40 MB).
import { cpSync, mkdirSync } from 'node:fs'
const src = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url)
const dst = new URL('../public/mediapipe-wasm/', import.meta.url)
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log('mediapipe wasm → public/mediapipe-wasm')
