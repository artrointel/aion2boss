import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_LOCAL_CACHE_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Not4You-Meter',
  'field-boss-server-cache.json'
)
const LOCAL_CACHE_PATH = process.env.FIELD_BOSS_LOCAL_CACHE_PATH || ''
const EXISTING_MIRROR_URL = process.env.FIELD_BOSS_EXISTING_MIRROR_URL ||
  'https://raw.githubusercontent.com/artrointel/aion2boss/field-boss-cache/api/notmeter-field-boss-public.json'
const FETCH_TIMEOUT_MS = Number(process.env.FIELD_BOSS_CACHE_FETCH_TIMEOUT_MS) || 8000
const OUTPUT_PATHS = (process.env.FIELD_BOSS_CACHE_OUTPUT_PATHS || path.join('.field-boss-cache', 'api', 'notmeter-field-boss-public.json'))
  .split(path.delimiter)
  .map((outputPath) => outputPath.trim())
  .filter(Boolean)

function normalizeInteger(value, fallback = 0) {
  const number = Math.trunc(Number(value))
  return Number.isSafeInteger(number) ? number : fallback
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

async function fetchExistingMirror() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(`${EXISTING_MIRROR_URL}${EXISTING_MIRROR_URL.includes('?') ? '&' : '?'}v=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const cache = await response.json()
    if (!validatePublicCache(cache)) throw new Error('invalid existing mirror')
    return cache
  } catch (error) {
    console.warn(`Existing mirror unavailable; creating local-only cache: ${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
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

function mergeCaches(existingCache, localCache) {
  const serversById = new Map()
  if (Array.isArray(existingCache?.servers)) {
    existingCache.servers.forEach((server) => {
      const serverId = normalizeInteger(server?.serverId)
      if (serverId > 0) serversById.set(serverId, server)
    })
  }

  localCache.servers.map(convertLocalServer).forEach((server) => {
    serversById.set(server.serverId, server)
  })

  const servers = Array.from(serversById.values())
    .sort((a, b) => normalizeInteger(a.serverId) - normalizeInteger(b.serverId))
  const generatedAt = servers.reduce((max, server) => Math.max(max, normalizeInteger(server.generatedAt)), 0)

  return {
    schema: 'notmeter-field-boss-public-cache-v1',
    version: 1,
    generatedAt,
    expiresAfterSeconds: 900,
    maximumRegions: 6,
    servers,
    mirroredAt: Math.floor(Date.now() / 1000),
    mirroredFrom: localCache.sourcePath
  }
}

const resolvedLocalCachePath = await resolveLocalCachePath()
const localCache = JSON.parse(await readFile(resolvedLocalCachePath, 'utf8'))
localCache.sourcePath = resolvedLocalCachePath
validateLocalSnapshotCache(localCache)

const existingCache = await fetchExistingMirror()
const mirroredCache = mergeCaches(existingCache, localCache)
const body = `${JSON.stringify(mirroredCache, null, 2)}\n`

await Promise.all(OUTPUT_PATHS.map(async (outputPath) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body, 'utf8')
}))

const localServerIds = localCache.servers.map((server) => normalizeInteger(server.serverId)).join(', ')
console.log(`Mirrored local NotMeter field boss servers [${localServerIds}] into ${mirroredCache.servers.length} total servers.`)
