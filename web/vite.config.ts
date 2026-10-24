import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
