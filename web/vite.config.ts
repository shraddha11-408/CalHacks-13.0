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
    },
  },
})
