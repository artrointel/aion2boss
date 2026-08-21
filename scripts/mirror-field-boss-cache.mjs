import { mkdir, writeFile } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

const SOURCE_URL = 'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public'
const FIELD_BOSS_CACHE_REF_URL = 'https://api.github.com/repos/Not4You-Dev/NotMeter-Update/git/ref/heads/main'
const FIELD_BOSS_CACHE_IMMUTABLE_ROOT = 'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Update'
const EXISTING_MIRROR_URL = 'https://raw.githubusercontent.com/artrointel/aion2boss/field-boss-cache/api/notmeter-field-boss-public.json'
const FALLBACK_URLS = [
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Update/main/presence/notmeter-field-boss-public.json',
  'https://cdn.jsdelivr.net/gh/Not4You-Dev/NotMeter-Update@main/presence/notmeter-field-boss-public.json'
]
const OUTPUT_PATHS = (process.env.FIELD_BOSS_CACHE_OUTPUT_PATHS || path.join('.field-boss-cache', 'api', 'notmeter-field-boss-public.json'))
  .split(path.delimiter)
  .map((outputPath) => outputPath.trim())
  .filter(Boolean)
const TIMEOUT_MS = Number(process.env.FIELD_BOSS_CACHE_TIMEOUT_MS) || 120_000
const RETRY_COUNT = Number(process.env.FIELD_BOSS_CACHE_RETRY_COUNT) || 3
const RETRY_DELAY_MS = Number(process.env.FIELD_BOSS_CACHE_RETRY_DELAY_MS) || 10_000
const MIN_SERVER_COUNT = Number(process.env.FIELD_BOSS_CACHE_MIN_SERVER_COUNT) || 40

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
        Referer: 'https://notmeter.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; aion2boss-field-boss-cache-mirror/1.0; +https://artrointel.github.io/aion2boss/)'
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

async function fetchGitHubRefCache() {
  const reference = await fetchJsonWithRetry(FIELD_BOSS_CACHE_REF_URL)
  const revision = String(reference?.object?.sha || '').trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('invalid branch revision')
  }
  return fetchJsonWithRetry(`${FIELD_BOSS_CACHE_IMMUTABLE_ROOT}/${revision}/presence/notmeter-field-boss-public.json`)
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

function validateMirrorableFieldBossCache(cache) {
  validateFieldBossCache(cache)
  if (cache.servers.length < MIN_SERVER_COUNT) {
    throw new Error(`partial field boss cache: ${cache.servers.length} servers`)
  }
}

async function fetchFieldBossCache() {
  const sources = [
    { label: SOURCE_URL, fetch: async () => fetchJsonWithRetry(SOURCE_URL) },
    { label: FIELD_BOSS_CACHE_REF_URL, fetch: fetchGitHubRefCache },
    ...FALLBACK_URLS.map((url) => ({ label: url, fetch: async () => fetchJsonWithRetry(url) })),
    { label: EXISTING_MIRROR_URL, fetch: async () => fetchJsonWithRetry(EXISTING_MIRROR_URL) }
  ]
  const candidates = []
  const errors = []

  for (const source of sources) {
    try {
      const cache = await source.fetch()
      validateMirrorableFieldBossCache(cache)
      candidates.push({ cache, label: source.label })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${source.label}: ${message}`)
      console.warn(`Field boss cache source failed: ${source.label}: ${message}`)
    }
  }

  candidates.sort((a, b) => Number(b.cache?.generatedAt) - Number(a.cache?.generatedAt))
  const best = candidates[0]
  if (best) {
    console.log(`Selected field boss cache from ${best.label}, generated at ${best.cache.generatedAt}.`)
    return best
  }

  throw new Error(`no mirrorable field boss cache (${errors.join(' / ')})`)
}

const { cache, label } = await fetchFieldBossCache()

const mirroredCache = {
  ...cache,
  mirroredAt: Math.floor(Date.now() / 1000),
  mirroredFrom: label
}
const body = `${JSON.stringify(mirroredCache, null, 2)}\n`

await Promise.all(OUTPUT_PATHS.map(async (outputPath) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body, 'utf8')
}))

console.log(`Mirrored ${cache.servers.length} field boss servers generated at ${cache.generatedAt}.`)
