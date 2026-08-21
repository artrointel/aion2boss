import { mkdir, writeFile } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

const SOURCE_URL = 'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public'
const OUTPUT_PATHS = [
  path.join('public', 'api', 'notmeter-field-boss-public.json'),
  path.join('docs', 'api', 'notmeter-field-boss-public.json')
]
const TIMEOUT_MS = 60_000

async function fetchJson(url) {
  const targetUrl = new URL(url)
  targetUrl.searchParams.set('v', String(Date.now()))

  const body = await new Promise((resolve, reject) => {
    const request = https.get(targetUrl, {
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        responseBody += chunk
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        resolve(responseBody)
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error(`request timed out after ${TIMEOUT_MS}ms`))
    })
    request.on('error', reject)
  })

  return JSON.parse(body)
}

function validateFieldBossCache(cache) {
  if (
    cache?.schema !== 'notmeter-field-boss-public-cache-v1' ||
    Number(cache.version) !== 1 ||
    !Array.isArray(cache.servers) ||
    cache.servers.length === 0
  ) {
    throw new Error('invalid field boss cache')
  }
}

const cache = await fetchJson(SOURCE_URL)
validateFieldBossCache(cache)

const mirroredCache = {
  ...cache,
  mirroredAt: Math.floor(Date.now() / 1000),
  mirroredFrom: SOURCE_URL
}
const body = `${JSON.stringify(mirroredCache, null, 2)}\n`

await Promise.all(OUTPUT_PATHS.map(async (outputPath) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body, 'utf8')
}))

console.log(`Mirrored ${cache.servers.length} field boss servers generated at ${cache.generatedAt}.`)
