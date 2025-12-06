import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // Vite is blocking the ngrok host; explicitly allow it. If the ngrok
    // subdomain changes, update this list or set via ALLOWED_HOSTS env var.
    // For broader allowance during quick sharing you can try: allowedHosts: true (Vite >=5)
    // but we keep explicit list for safety.
    allowedHosts: (process.env.ALLOWED_HOSTS
      ? process.env.ALLOWED_HOSTS.split(/[,\s]+/).filter(Boolean)
      : [
          'hyperethically-nonforfeitable-yajaira.ngrok-free.dev'
        ]
    ),
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
})
