import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// The admin is served from the binary under /_/ (see src/admin/embed.ts), so the
// build must reference assets under that base and route there. In dev we proxy
// /api to a running `cogworks` server (default :8090).
export default defineConfig({
  base: '/_/',
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8090', changeOrigin: true },
    },
  },
})
