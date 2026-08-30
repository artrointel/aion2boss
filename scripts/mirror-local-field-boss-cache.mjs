import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { verify as verifySignature } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_LOCAL_CACHE_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Not4You-Meter',
  'field-boss-server-cache.json'
)
const LOCAL_CACHE_PATH = process.env.FIELD_BOSS_LOCAL_CACHE_PATH || ''
const SKIP_LOCAL_CACHE = process.env.FIELD_BOSS_SKIP_LOCAL_CACHE === 'true'
const ALLOW_MISSING_LOCAL_CACHE = process.env.FIELD_BOSS_ALLOW_MISSING_LOCAL_CACHE === 'true'
const LEGACY_NOTMETER_VPS_CACHE_URL = 'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public'
const NOTMETER_VPS_CACHE_URL_OVERRIDE = process.env.FIELD_BOSS_NOTMETER_VPS_CACHE_URL || ''
const NOTMETER_CONTROL_SCHEMA = 'notmeter-control-endpoint-v1'
const NOTMETER_CONTROL_SIGNATURE_ALGORITHM = 'RSA-SHA256-PKCS1-v1'
const NOTMETER_CONTROL_KEY_ID = 'notmeter-ranking-2026-07'
const NOTMETER_CONTROL_MAX_LIFETIME_SECONDS = 14 * 24 * 60 * 60
const NOTMETER_CONTROL_PUBLIC_KEY_BASE64 = 'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArn8f2jGTdnIRUHtso8FmmUcmN7rgOzJ7lQRcy9e3Lekt8S2Tg8L1++9/8AKAhnY/hpJbdHkgdTvvv3oyGZVMU/owyv7u9CcmiKQm1dIx7JkoHz0fnBbpytyVRH9Y21HF/PyLX6GcHmkYsfA5keNq3BjK/C+3MTuC8h9EFGPlWBlDwTuLOq4ky4McZMBV5wAu15xLvcyPHeaUhGMuc2XufGyyLLXV2hHXpUsIKZineKWEyN3UoaCXnWzAw5VqSd6cfhB5jY3CFFnthMbQk62ddJUT2B6GWZHjz39rg0u6qSTuGWW1M3BfUR+F6GUllxgDumWmxPHfNcs5MI4rNGsKyuLRrk6z85EYIyL4eduEM8NaQQ5gY03BsgT81jTFfbG+PVgqgkz9t322JycjgCUKLlva0FlZzGXmE57d7N5KcxMlnfdpPq5dcmyvLN2J8vAK4Sct9bKjUEZWeA4npCIHpBPXob9WlTkuLPasWrkuHiUPPPx5xfZzmnRKmCswr0fdAgMBAAE='
const DEFAULT_NOTMETER_CONTROL_URLS = [
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Web/main/control/notmeter-control-endpoint.json',
  'https://notmeter.com/control/notmeter-control-endpoint.json',
  'https://api.github.com/repos/Not4You-Dev/NotMeter-Web/contents/control/notmeter-control-endpoint.json?ref=main'
]
const EXISTING_MIRROR_URL = process.env.FIELD_BOSS_EXISTING_MIRROR_URL ||
  'https://raw.githubusercontent.com/artrointel/aion2boss/field-boss-cache/api/notmeter-field-boss-public.json'
const DEFAULT_NOTMETER_PUBLIC_CACHE_URLS = [
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Web/main/presence/notmeter-field-boss-public.json',
  'https://notmeter.com/presence/notmeter-field-boss-public.json'
]
const FETCH_TIMEOUT_MS = Number(process.env.FIELD_BOSS_CACHE_FETCH_TIMEOUT_MS) || 8000
const MAX_OUTPUT_AGE_SECONDS = Number(process.env.FIELD_BOSS_CACHE_MAX_OUTPUT_AGE_SECONDS) || 0
const OUTPUT_PATHS = (process.env.FIELD_BOSS_CACHE_OUTPUT_PATHS || path.join('.field-boss-cache', 'api', 'notmeter-field-boss-public.json'))
  .split(path.delimiter)
  .map((outputPath) => outputPath.trim())
  .filter(Boolean)
const SOURCE_NAMES = {
  vps: 'NotMeter VPS API',
  local: 'Artrointel Local NotMeter',
  public: 'NotMeter Public JSON',
  mirror: 'NotMeter Cache Mirror'
}
const SOURCE_PRIORITY = {
  [SOURCE_NAMES.vps]: 0,
  [SOURCE_NAMES.local]: 1,
  [SOURCE_NAMES.public]: 2,
  [SOURCE_NAMES.mirror]: 3
}

function normalizeInteger(value, fallback = 0) {
  const number = Math.trunc(Number(value))
  return Number.isSafeInteger(number) ? number : fallback
}

function formatKstTimestamp(seconds) {
  const timestamp = normalizeInteger(seconds)
  if (timestamp <= 0) return 'unknown'

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestamp * 1000))
}

function countCacheEntries(cache) {
  return (cache?.servers || []).reduce((serverSum, server) =>
    serverSum + (server?.regions || []).reduce((regionSum, region) =>
      regionSum + (Array.isArray(region?.entries) ? region.entries.length : 0), 0), 0)
}

function getCacheMaxGeneratedAt(cache) {
  return (cache?.servers || []).reduce((max, server) =>
    Math.max(max, normalizeInteger(server?.generatedAt)), normalizeInteger(cache?.generatedAt))
}

function createCandidateSummary(name, cache, url = null) {
  if (!cache) {
    return {
      name,
      ...(url ? { url } : {}),
      available: false
    }
  }

  const generatedAt = getCacheMaxGeneratedAt(cache)
  return {
    name,
    ...(url ? { url } : {}),
    available: true,
    generatedAt,
    generatedAtKst: formatKstTimestamp(generatedAt),
    serverCount: Array.isArray(cache.servers) ? cache.servers.length : 0,
    entryCount: countCacheEntries(cache)
  }
}

function logCandidateSummaries(candidateSummaries) {
  console.log('Field boss cache candidates:')
  candidateSummaries.forEach((summary) => {
    if (!summary.available) {
      console.log(`- ${summary.name}: unavailable${summary.url ? ` (${summary.url})` : ''}`)
      return
    }

    console.log(
      `- ${summary.name}: generatedAt=${summary.generatedAt} (${summary.generatedAtKst} KST), ` +
      `servers=${summary.serverCount}, entries=${summary.entryCount}${summary.url ? `, url=${summary.url}` : ''}`
    )
  })
}

function parseUrlList(value, fallback) {
  const source = value || fallback.join('\n')
  return source
    .split(/\r?\n|,/)
    .map((url) => url.trim())
    .filter(Boolean)
}

const NOTMETER_PUBLIC_CACHE_URLS = parseUrlList(
  process.env.FIELD_BOSS_NOTMETER_PUBLIC_CACHE_URLS,
  DEFAULT_NOTMETER_PUBLIC_CACHE_URLS
)
const NOTMETER_CONTROL_URLS = parseUrlList(
  process.env.FIELD_BOSS_NOTMETER_CONTROL_URLS,
  DEFAULT_NOTMETER_CONTROL_URLS
)

function toPemPublicKey(base64) {
  const lines = base64.match(/.{1,64}/g) || []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`
}

function normalizeControlEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname && url.pathname !== '/')
    ) {
      return null
    }
    return `${url.protocol}//${url.hostname}`
  } catch {
    return null
  }
}

function validateControlDocument(document) {
  if (
    document?.schema !== NOTMETER_CONTROL_SCHEMA ||
    normalizeInteger(document?.version) !== 1 ||
    document?.signatureAlgorithm !== NOTMETER_CONTROL_SIGNATURE_ALGORITHM ||
    document?.keyId !== NOTMETER_CONTROL_KEY_ID ||
    !/^[0-9a-f]{12,64}$/i.test(String(document?.generation || ''))
  ) {
    return null
  }

  const primary = normalizeControlEndpoint(document.primaryBaseUrl)
  const fallbacks = Array.isArray(document.fallbackBaseUrls)
    ? document.fallbackBaseUrls.slice(0, 3).map(normalizeControlEndpoint).filter(Boolean)
    : []
  const endpoints = [...new Set([primary, ...fallbacks].filter(Boolean))]
  const generatedAt = normalizeInteger(document.generatedAtUnixSeconds)
  const validUntil = normalizeInteger(document.validUntilUnixSeconds)
  const now = Math.floor(Date.now() / 1000)
  if (
    endpoints.length === 0 || generatedAt <= 0 || validUntil <= generatedAt ||
    validUntil - generatedAt > NOTMETER_CONTROL_MAX_LIFETIME_SECONDS ||
    generatedAt > now + 600 || now > validUntil
  ) {
    return null
  }

  const payload = [
    NOTMETER_CONTROL_SCHEMA,
    '1',
    String(document.generation).trim().toLowerCase(),
    String(generatedAt),
    String(validUntil),
    endpoints[0],
    endpoints.slice(1).join(','),
    NOTMETER_CONTROL_SIGNATURE_ALGORITHM,
    NOTMETER_CONTROL_KEY_ID
  ].join('\n')
  const signature = String(document.signature || '').replace(/\s+/g, '')

  try {
    const valid = verifySignature(
      'RSA-SHA256',
      Buffer.from(payload, 'utf8'),
      toPemPublicKey(NOTMETER_CONTROL_PUBLIC_KEY_BASE64),
      Buffer.from(signature, 'base64')
    )
    return valid ? { endpoints, generatedAt, validUntil, generation: document.generation } : null
  } catch {
    return null
  }
}

async function fetchJson(url, label, timeoutMs = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    console.warn(`${label} unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveNotMeterVpsCacheUrls() {
  const overrideUrls = parseUrlList(NOTMETER_VPS_CACHE_URL_OVERRIDE, [])
  if (overrideUrls.length) {
    console.log(`Using FIELD_BOSS_NOTMETER_VPS_CACHE_URL override: ${overrideUrls.join(', ')}`)
    return { urls: overrideUrls, control: null }
  }

  for (const controlUrl of NOTMETER_CONTROL_URLS) {
    let document = await fetchJson(controlUrl, `NotMeter control endpoint ${controlUrl}`)
    if (document?.encoding?.toLowerCase() === 'base64' && typeof document.content === 'string') {
      try {
        document = JSON.parse(Buffer.from(document.content.replace(/\s+/g, ''), 'base64').toString('utf8'))
      } catch {
        document = null
      }
    }

    const control = validateControlDocument(document)
    if (!control) {
      console.warn(`NotMeter control endpoint rejected: ${controlUrl}`)
      continue
    }

    const urls = control.endpoints.map((endpoint) => `${endpoint}/field-boss/v1/public`)
    console.log(
      `NotMeter control endpoint generation=${control.generation}, ` +
      `validUntil=${formatKstTimestamp(control.validUntil)} KST, endpoints=${urls.join(', ')}`
    )
    return { urls, control: { ...control, sourceUrl: controlUrl } }
  }

  console.warn(`No valid NotMeter control endpoint. Falling back to legacy URL: ${LEGACY_NOTMETER_VPS_CACHE_URL}`)
  return { urls: [LEGACY_NOTMETER_VPS_CACHE_URL], control: null }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findUserProfileCaches() {
  const usersRoot = process.env.SystemDrive ? `${process.env.SystemDrive}\\Users` : 'C:\\Users'
  let entries = []

  try {
    entries = await readdir(usersRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(usersRoot, entry.name, 'AppData', 'Local', 'Not4You-Meter', 'field-boss-server-cache.json')
    try {
      const info = await stat(candidate)
      candidates.push({ path: candidate, mtimeMs: info.mtimeMs })
    } catch {
      // Ignore profiles without a NotMeter field boss cache.
    }
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function resolveLocalCachePath() {
  if (SKIP_LOCAL_CACHE) {
    return null
  }

  const explicitPath = LOCAL_CACHE_PATH.trim()
  if (explicitPath) {
    try {
      await access(explicitPath)
      return explicitPath
    } catch (error) {
      const reason = error instanceof Error ? `${error.message} (${error.code || 'unknown'})` : String(error)
      throw new Error(`FIELD_BOSS_LOCAL_CACHE_PATH is not readable: ${explicitPath}. ${reason}`)
    }
  }

  if (await fileExists(DEFAULT_LOCAL_CACHE_PATH)) {
    return DEFAULT_LOCAL_CACHE_PATH
  }

  const userProfileCaches = await findUserProfileCaches()
  if (userProfileCaches.length) {
    return userProfileCaches[0].path
  }

  if (ALLOW_MISSING_LOCAL_CACHE) {
    return null
  }

  throw new Error(`NotMeter local field boss cache not found. Set FIELD_BOSS_LOCAL_CACHE_PATH to the full path, e.g. C:\\Users\\<user>\\AppData\\Local\\Not4You-Meter\\field-boss-server-cache.json`)
}

function validateLocalSnapshotCache(cache) {
  if (normalizeInteger(cache?.version) !== 1 || !Array.isArray(cache?.servers) || cache.servers.length === 0) {
    throw new Error('invalid NotMeter local field boss cache')
  }

  cache.servers.forEach((server) => {
    if (
      server?.schema !== 'notmeter-field-boss-snapshot-v1' ||
      normalizeInteger(server.version) !== 1 ||
      normalizeInteger(server.serverId) <= 0 ||
      normalizeInteger(server.generatedAt) <= 0 ||
      !Array.isArray(server.regions)
    ) {
      throw new Error('invalid NotMeter local field boss snapshot')
    }
  })
}

function validatePublicCache(cache) {
  return cache?.schema === 'notmeter-field-boss-public-cache-v1' &&
    normalizeInteger(cache.version) === 1 &&
    Array.isArray(cache.servers)
}

async function fetchPublicCache(url, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const cache = await response.json()
    if (!validatePublicCache(cache)) throw new Error('invalid public cache')
    return cache
  } catch (error) {
    console.warn(`${label} unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function fetchExistingMirror() {
  return fetchPublicCache(EXISTING_MIRROR_URL, SOURCE_NAMES.mirror)
}

async function fetchNotMeterVpsCaches(urls) {
  const results = await Promise.all(urls.map(async (url) => ({
    url,
    cache: await fetchPublicCache(url, `${SOURCE_NAMES.vps} ${url}`)
  })))
  return results.filter((result) => result.cache)
}

async function fetchNotMeterPublicCaches() {
  const results = await Promise.all(NOTMETER_PUBLIC_CACHE_URLS.map(async (url) => ({
    url,
    cache: await fetchPublicCache(url, `NotMeter public cache ${url}`)
  })))
  return results.filter((result) => result.cache)
}

function convertLocalServer(server) {
  return {
    serverId: normalizeInteger(server.serverId),
    generatedAt: normalizeInteger(server.generatedAt),
    regions: server.regions.map((region) => ({
      region: normalizeInteger(region.region),
      observedAt: normalizeInteger(region.observedAt),
      entries: Array.isArray(region.entries)
        ? region.entries.map((entry) => ({
          bossCode: normalizeInteger(entry.bossCode),
          targetAt: normalizeInteger(entry.targetAt)
        }))
        : []
    }))
  }
}

function useNewerServer(current, candidate) {
  if (!current) return true
  const currentGeneratedAt = normalizeInteger(current.generatedAt)
  const candidateGeneratedAt = normalizeInteger(candidate.generatedAt)
  if (candidateGeneratedAt !== currentGeneratedAt) {
    return candidateGeneratedAt > currentGeneratedAt
  }

  const currentEntryCount = (current.regions || []).reduce((sum, region) =>
    sum + (Array.isArray(region?.entries) ? region.entries.length : 0), 0)
  const candidateEntryCount = (candidate.regions || []).reduce((sum, region) =>
    sum + (Array.isArray(region?.entries) ? region.entries.length : 0), 0)
  if (candidateEntryCount !== currentEntryCount) {
    return candidateEntryCount > currentEntryCount
  }

  return (SOURCE_PRIORITY[candidate.mirroredSource?.name] ?? 99) <
    (SOURCE_PRIORITY[current.mirroredSource?.name] ?? 99)
}

function createSource(name, url, updatedAt) {
  return {
    name,
    updatedAt: normalizeInteger(updatedAt),
    ...(url ? { url } : {})
  }
}

function addPublicServers(serversById, cache, sourceName, sourceUrl) {
  if (!Array.isArray(cache?.servers)) return

  cache.servers.forEach((server) => {
    const serverId = normalizeInteger(server?.serverId)
    if (serverId <= 0) return

    const candidate = {
      ...server,
      serverId,
      source: createSource(sourceName, sourceUrl, server?.generatedAt),
      mirroredSource: createSource(sourceName, sourceUrl, server?.generatedAt)
    }
    if (useNewerServer(serversById.get(serverId), candidate)) {
      serversById.set(serverId, candidate)
    }
  })
}

function addLocalServers(serversById, localCache) {
  if (!Array.isArray(localCache?.servers)) return

  localCache.servers.map(convertLocalServer).forEach((server) => {
    const candidate = {
      ...server,
      source: createSource(SOURCE_NAMES.local, localCache.sourcePath, server.generatedAt),
      mirroredSource: createSource(SOURCE_NAMES.local, localCache.sourcePath, server.generatedAt)
    }
    if (useNewerServer(serversById.get(server.serverId), candidate)) {
      serversById.set(server.serverId, candidate)
    }
  })
}

function stripMirrorMetadata(server) {
  const { mirroredSource, ...publicServer } = server
  return publicServer
}

function mergeCaches(existingCache, notMeterVpsCaches, notMeterPublicCaches, localCache, candidateSummaries = [], vpsResolution = null) {
  const serversById = new Map()

  addPublicServers(serversById, existingCache, SOURCE_NAMES.mirror, EXISTING_MIRROR_URL)
  notMeterVpsCaches.forEach(({ cache, url }) => {
    addPublicServers(serversById, cache, SOURCE_NAMES.vps, url)
  })
  notMeterPublicCaches.forEach(({ cache, url }) => {
    addPublicServers(serversById, cache, SOURCE_NAMES.public, url)
  })
  addLocalServers(serversById, localCache)

  const servers = Array.from(serversById.values())
    .sort((a, b) => normalizeInteger(a.serverId) - normalizeInteger(b.serverId))
    .map(stripMirrorMetadata)
  const generatedAt = servers.reduce((max, server) => Math.max(max, normalizeInteger(server.generatedAt)), 0)
  const sourceCount = Array.from(serversById.values()).reduce((counts, server) => {
    const source = server.mirroredSource?.name || 'unknown'
    counts[source] = (counts[source] || 0) + 1
    return counts
  }, {})

  return {
    schema: 'notmeter-field-boss-public-cache-v1',
    version: 1,
    generatedAt,
    expiresAfterSeconds: 900,
    maximumRegions: 6,
    servers,
    mirroredAt: Math.floor(Date.now() / 1000),
    mirroredFrom: {
      sources: {
        [SOURCE_NAMES.vps]: vpsResolution?.urls || [],
        [SOURCE_NAMES.local]: localCache?.sourcePath || null,
        [SOURCE_NAMES.public]: NOTMETER_PUBLIC_CACHE_URLS,
        [SOURCE_NAMES.mirror]: EXISTING_MIRROR_URL
      },
      vpsControl: vpsResolution?.control || null,
      selectedServerCounts: sourceCount,
      candidateSummaries
    }
  }
}

function warnIfStaleOutput(cache) {
  if (MAX_OUTPUT_AGE_SECONDS <= 0) return

  const generatedAt = normalizeInteger(cache?.generatedAt)
  const ageSeconds = Math.floor(Date.now() / 1000) - generatedAt
  console.log(
    `Selected field boss cache generatedAt=${generatedAt} ` +
    `(${formatKstTimestamp(generatedAt)} KST), age=${ageSeconds}s, maxAge=${MAX_OUTPUT_AGE_SECONDS}s.`
  )

  if (generatedAt <= 0 || ageSeconds > MAX_OUTPUT_AGE_SECONDS) {
    console.warn(
      `Publishing stale field boss cache because it is still the newest available candidate. ` +
      `Newest generatedAt is ${formatKstTimestamp(generatedAt)} KST, age ${ageSeconds}s, ` +
      `limit ${MAX_OUTPUT_AGE_SECONDS}s.`
    )
  }
}

const resolvedLocalCachePath = await resolveLocalCachePath()
const localCache = resolvedLocalCachePath
  ? JSON.parse(await readFile(resolvedLocalCachePath, 'utf8'))
  : null

if (localCache) {
  localCache.sourcePath = resolvedLocalCachePath
  validateLocalSnapshotCache(localCache)
}

const vpsResolution = await resolveNotMeterVpsCacheUrls()
const [existingCache, notMeterVpsCaches, notMeterPublicCaches] = await Promise.all([
  fetchExistingMirror(),
  fetchNotMeterVpsCaches(vpsResolution.urls),
  fetchNotMeterPublicCaches()
])
const candidateSummaries = [
  createCandidateSummary(SOURCE_NAMES.mirror, existingCache, EXISTING_MIRROR_URL),
  ...vpsResolution.urls.map((url) => {
    const match = notMeterVpsCaches.find((candidate) => candidate.url === url)
    return createCandidateSummary(SOURCE_NAMES.vps, match?.cache || null, url)
  }),
  ...NOTMETER_PUBLIC_CACHE_URLS.map((url) => {
    const match = notMeterPublicCaches.find((candidate) => candidate.url === url)
    return createCandidateSummary(SOURCE_NAMES.public, match?.cache || null, url)
  }),
  createCandidateSummary(SOURCE_NAMES.local, localCache, localCache?.sourcePath || null)
]
logCandidateSummaries(candidateSummaries)

const mirroredCache = mergeCaches(
  existingCache,
  notMeterVpsCaches,
  notMeterPublicCaches,
  localCache,
  candidateSummaries,
  vpsResolution
)
warnIfStaleOutput(mirroredCache)
const body = `${JSON.stringify(mirroredCache, null, 2)}\n`

await Promise.all(OUTPUT_PATHS.map(async (outputPath) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body, 'utf8')
}))

const localServerIds = localCache?.servers?.map((server) => normalizeInteger(server.serverId)).join(', ') || 'none'
console.log(`Selected server counts: ${JSON.stringify(mirroredCache.mirroredFrom.selectedServerCounts)}`)
console.log(`Mirrored NotMeter field boss cache with local servers [${localServerIds}] into ${mirroredCache.servers.length} total servers.`)
