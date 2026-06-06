import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { internalIpV4 } from 'internal-ip'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mobile = /android|ios/.test(process.env.TAURI_ENV_PLATFORM ?? '')
const serverTarget = process.env.MEDIA_TOOL_SERVER_URL ?? 'http://127.0.0.1:8080'
const strictPort = process.env.MEDIA_TOOL_STRICT_PORT === 'true'
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  version?: string
}
const packageVersion = packageJson.version ?? '0.0.0'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageVersion),
  },
  base: '/',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort,
    host: '0.0.0.0',
    hmr: mobile
      ? {
          protocol: 'ws',
          host: await internalIpV4(),
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      '/api': {
        target: serverTarget,
        changeOrigin: true,
      },
      '/static': {
        target: serverTarget,
        changeOrigin: true,
      },
    },
  },
})
