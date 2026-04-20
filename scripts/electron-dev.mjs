import http from 'node:http'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, '..')
const port = Number(process.env.ELECTRON_RENDERER_PORT || 5173)
const host = '127.0.0.1'
const devServerUrl = `http://${host}:${port}`
const viteCliPath = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const electronBinary = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron')

if (!existsSync(electronBinary)) {
  throw new Error('Electron is not installed. Run `npm install` before starting desktop mode.')
}

if (!existsSync(viteCliPath)) {
  throw new Error('Vite is not installed. Run `npm install` before starting desktop mode.')
}

let viteProcess = null
let electronProcess = null

function shutdown(exitCode = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill()
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill()
  }
  process.exit(exitCode)
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const ping = () => {
      const request = http.get(url, (response) => {
        response.resume()
        resolve()
      })

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`))
          return
        }

        setTimeout(ping, 250)
      })
    }

    ping()
  })
}

async function start() {
  viteProcess = spawn(
    process.execPath,
    [viteCliPath, '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env
      }
    }
  )

  viteProcess.on('exit', (code) => {
    if (code !== 0) {
      shutdown(code ?? 1)
    }
  })

  await waitForServer(devServerUrl)

  electronProcess = spawn(electronBinary, ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  })

  electronProcess.on('exit', (code) => {
    shutdown(code ?? 0)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

start().catch((error) => {
  console.error(error)
  shutdown(1)
})
