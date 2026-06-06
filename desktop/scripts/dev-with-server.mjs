import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const desktopDir = resolve(__dirname, '..')
const repoRoot = resolve(desktopDir, '..')
const detectTimeoutMs = Number.parseInt(process.env.MEDIA_TOOL_DETECT_TIMEOUT_MS ?? '120000', 10)

let frontendStarted = false
let shuttingDown = false
let frontendChild = null
let detectTimer = null
const checkedCandidates = new Set()

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
    ...process.env,
    MEDIA_TOOL_SERVER_URL: serverUrl,
  }

  frontendChild = spawn('npm', ['run', 'dev'], {
    cwd: desktopDir,
    stdio: 'inherit',
    env,
  })

  frontendChild.on('exit', (code) => {
    shutdown(code ?? 0)
  })
}

const serverChild = spawn('cargo', ['run', '--', 'serve', '--port', '0'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})

const serverReadyPattern = /media-tool-rs ui api is running at (http:\/\/127\.0\.0\.1:\d+)/

detectTimer = setTimeout(() => {
  if (frontendStarted) {
    return
  }

  console.error('[dev] failed to detect backend address in time; ensure cargo can start the server')
  shutdown(1)
}, detectTimeoutMs)

function handleServerOutput(chunk, outputFn) {
  const text = chunk.toString()
  outputFn(text)

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
