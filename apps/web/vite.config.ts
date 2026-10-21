import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Local dev only: the repo lives on the Windows filesystem (/mnt/c) while Vite runs in WSL —
  // native fs events don't cross that boundary, so HMR needs polling to see file changes at all.
  server: { watch: { usePolling: true, interval: 300 } },
})
