import { mkdir, writeFile } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

const SOURCE_URL = 'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public'
const OUTPUT_PATHS = (process.env.FIELD_BOSS_CACHE_OUTPUT_PATHS || path.join('.field-boss-cache', 'api', 'notmeter-field-boss-public.json'))
  .split(path.delimiter)
  .map((outputPath) => outputPath.trim())
  .filter(Boolean)
const TIMEOUT_MS = Number(process.env.FIELD_BOSS_CACHE_TIMEOUT_MS) || 120_000
const RETRY_COUNT = Number(process.env.FIELD_BOSS_CACHE_RETRY_COUNT) || 3
const RETRY_DELAY_MS = Number(process.env.FIELD_BOSS_CACHE_RETRY_DELAY_MS) || 10_000

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url) {
  const targetUrl = new URL(url)
  targetUrl.searchParams.set('v', String(Date.now()))

  const body = await new Promise((resolve, reject) => {
    const request = https.get(targetUrl, {
      family: 4,
      headers: {
        Accept: 'application/json',
        Origin: 'https://not4you-dev.github.io',
        'User-Agent': 'aion2boss-field-boss-cache-mirror/1.0'
      },
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

async function fetchJsonWithRetry(url) {
  let lastError = null

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      console.log(`Fetching field boss cache, attempt ${attempt}/${RETRY_COUNT}.`)
      return await fetchJson(url)
    } catch (error) {
      lastError = error
      console.warn(`Attempt ${attempt}/${RETRY_COUNT} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt < RETRY_COUNT) {
        await wait(RETRY_DELAY_MS)
      }
    }
  }

  throw lastError
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

const cache = await fetchJsonWithRetry(SOURCE_URL)
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
