import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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
const NOTMETER_VPS_CACHE_URL = process.env.FIELD_BOSS_NOTMETER_VPS_CACHE_URL ||
  'https://notmeter.112-168-140-142.sslip.io/field-boss/v1/public'
const EXISTING_MIRROR_URL = process.env.FIELD_BOSS_EXISTING_MIRROR_URL ||
  'https://raw.githubusercontent.com/artrointel/aion2boss/field-boss-cache/api/notmeter-field-boss-public.json'
const DEFAULT_NOTMETER_PUBLIC_CACHE_URLS = [
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Update/main/presence/notmeter-field-boss-public.json',
  'https://cdn.jsdelivr.net/gh/Not4You-Dev/NotMeter-Update@main/presence/notmeter-field-boss-public.json'
]
const FETCH_TIMEOUT_MS = Number(process.env.FIELD_BOSS_CACHE_FETCH_TIMEOUT_MS) || 8000
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

function fetchNotMeterVpsCache() {
  return fetchPublicCache(NOTMETER_VPS_CACHE_URL, SOURCE_NAMES.vps)
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

function mergeCaches(existingCache, notMeterVpsCache, notMeterPublicCaches, localCache) {
  const serversById = new Map()

  addPublicServers(serversById, existingCache, SOURCE_NAMES.mirror, EXISTING_MIRROR_URL)
  addPublicServers(serversById, notMeterVpsCache, SOURCE_NAMES.vps, NOTMETER_VPS_CACHE_URL)
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
        [SOURCE_NAMES.vps]: NOTMETER_VPS_CACHE_URL,
        [SOURCE_NAMES.local]: localCache?.sourcePath || null,
        [SOURCE_NAMES.public]: NOTMETER_PUBLIC_CACHE_URLS,
        [SOURCE_NAMES.mirror]: EXISTING_MIRROR_URL
      },
      selectedServerCounts: sourceCount
    }
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

const [existingCache, notMeterVpsCache, notMeterPublicCaches] = await Promise.all([
  fetchExistingMirror(),
  fetchNotMeterVpsCache(),
  fetchNotMeterPublicCaches()
])
const mirroredCache = mergeCaches(existingCache, notMeterVpsCache, notMeterPublicCaches, localCache)
const body = `${JSON.stringify(mirroredCache, null, 2)}\n`

await Promise.all(OUTPUT_PATHS.map(async (outputPath) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body, 'utf8')
}))

const localServerIds = localCache?.servers?.map((server) => normalizeInteger(server.serverId)).join(', ') || 'none'
console.log(`Mirrored NotMeter field boss cache with local servers [${localServerIds}] into ${mirroredCache.servers.length} total servers.`)
