import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync('package.json', 'utf8')).version,
    ),
  },
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  server: { strictPort: true },
})
