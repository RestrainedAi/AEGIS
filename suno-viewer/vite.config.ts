import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/catalog.csv': 'http://localhost:8080' }
  },
  build: { outDir: 'dist' }
})
