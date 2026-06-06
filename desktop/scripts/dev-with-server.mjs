import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const desktopDir = resolve(__dirname, '..')
const repoRoot = resolve(desktopDir, '..')
const detectTimeoutMs = Number.parseInt(process.env.MEDIA_TOOL_DETECT_TIMEOUT_MS ?? '300000', 10)
const forceStrictPort = process.argv.includes('--strict-port')
const backendBinaryName = process.platform === 'win32' ? 'media-tool-rs.exe' : 'media-tool-rs'
const backendBinaryPath = resolve(repoRoot, 'target', 'debug', backendBinaryName)

let frontendStarted = false
let shuttingDown = false
let frontendChild = null
let detectTimer = null
const checkedCandidates = new Set()
let backendStartedWithCargo = false
let sawCargoLockWait = false

function getSpawnSafeEnv(baseEnv) {
  // Windows can expose pseudo environment keys that begin with '=', which
  // cause child_process.spawn to fail with EINVAL when passed back in `env`.
  return Object.fromEntries(
    Object.entries(baseEnv).filter(([key]) => key && !key.startsWith('=')),
  )
}

async function isHealthy(serverUrl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  if (detectTimer) {
    clearTimeout(detectTimer)
    detectTimer = null
  }

  if (frontendChild && !frontendChild.killed) {
    frontendChild.kill('SIGTERM')
  }
  if (!serverChild.killed) {
    serverChild.kill('SIGTERM')
  }

  process.exit(exitCode)
}

async function tryStartFromCandidate(serverUrl) {
  if (frontendStarted || !serverUrl || checkedCandidates.has(serverUrl)) {
    return false
  }

  checkedCandidates.add(serverUrl)
  const ok = await isHealthy(serverUrl)
  if (!ok) {
    return false
  }

  startFrontend(serverUrl)
  return true
}

function startFrontend(serverUrl) {
  if (frontendStarted) {
    return
  }
  frontendStarted = true

  if (detectTimer) {
    clearTimeout(detectTimer)
    detectTimer = null
  }

  console.log(`[dev] detected backend ${serverUrl}`)
  const env = {
    ...getSpawnSafeEnv(process.env),
    MEDIA_TOOL_SERVER_URL: serverUrl,
    MEDIA_TOOL_STRICT_PORT: forceStrictPort ? 'true' : (process.env.MEDIA_TOOL_STRICT_PORT ?? 'false'),
  }

  const viteCliPath = resolve(desktopDir, 'node_modules', 'vite', 'bin', 'vite.js')

  frontendChild = spawn(process.execPath, [viteCliPath], {
    cwd: desktopDir,
    stdio: 'inherit',
    env,
  })

  frontendChild.on('error', (error) => {
    console.error(`[dev] failed to start frontend process: ${error.message}`)
    shutdown(1)
  })

  frontendChild.on('exit', (code) => {
    shutdown(code ?? 0)
  })
}

function startBackend() {
  const spawnOptions = {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getSpawnSafeEnv(process.env),
  }

  if (existsSync(backendBinaryPath)) {
    console.log(`[dev] launching backend binary: ${backendBinaryPath}`)
    backendStartedWithCargo = false
    return spawn(backendBinaryPath, ['serve', '--port', '0'], spawnOptions)
  }

  console.log('[dev] backend binary not found, falling back to cargo run')
  backendStartedWithCargo = true
  return spawn('cargo', ['run', '--', 'serve', '--port', '0'], spawnOptions)
}

const serverChild = startBackend()

const serverReadyPattern = /media-tool-rs ui api is running at (http:\/\/127\.0\.0\.1:\d+)/

detectTimer = setTimeout(() => {
  if (frontendStarted) {
    return
  }

  if (backendStartedWithCargo && sawCargoLockWait) {
    console.error('[dev] failed to detect backend address in time; cargo is waiting on package cache lock')
  } else {
    console.error('[dev] failed to detect backend address in time; ensure backend can start')
  }
  shutdown(1)
}, detectTimeoutMs)

function handleServerOutput(chunk, outputFn) {
  const text = chunk.toString()
  outputFn(text)

  if (backendStartedWithCargo && text.includes('Blocking waiting for file lock on package cache')) {
    sawCargoLockWait = true
  }

  if (frontendStarted) {
    return
  }

  const matched = text.match(serverReadyPattern)
  if (!matched) {
    return
  }

  const serverUrl = matched[1]
  void tryStartFromCandidate(serverUrl)
}

serverChild.stdout.on('data', (chunk) => {
  handleServerOutput(chunk, (text) => process.stdout.write(`[server] ${text}`))
})

serverChild.stderr.on('data', (chunk) => {
  handleServerOutput(chunk, (text) => process.stderr.write(`[server] ${text}`))
})

serverChild.on('exit', (code) => {
  if (!frontendStarted) {
    process.exit(code ?? 1)
    return
  }

  shutdown(code ?? 0)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
