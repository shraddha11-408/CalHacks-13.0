import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

// HTTPS when run.sh has made a self-signed cert: the camera and mic only work on a secure page,
// and a LAN address over plain http is not one. No cert → plain http as before.
const certDir = path.resolve(__dirname, '.cert')
const keyFile = path.join(certDir, 'key.pem')
const certFile = path.join(certDir, 'cert.pem')
const https =
  fs.existsSync(keyFile) && fs.existsSync(certFile)
    ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
    : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https,
    host: true, // also on this laptop's network address, so phones on the same Wi-Fi can open it
    allowedHosts: ['.trycloudflare.com'], // temporary phone link (cloudflared quick tunnel) when the Wi-Fi blocks phone → laptop
    // Edge app (FastAPI) on :8000, reached as /api/* from the browser.
    proxy: {
      '/api': {
        // EDGE_URL lets a second web server point at a test edge (e.g. a file camera on :8001)
        target: process.env.EDGE_URL ?? 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
        ws: true, // /api/ws/events
      },
      // Local SpacetimeDB through the web server, so phones on the same network (buddy page)
      // only need this one address. The SDK always connects to <origin>/v1/..., so /v1 is proxied
      // as-is. Maincloud is reached directly.
      '/v1': {
        target: process.env.STDB_URL ?? 'http://127.0.0.1:3000',
        ws: true,
      },
    },
  },
})
