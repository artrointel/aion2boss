import { readLocalStorage, readSessionStorage, writeLocalStorage, writeSessionStorage } from './storage'

const pad2 = (num) => String(num).padStart(2, '0')

export const CONFIG = {
  FIREBASE: {
    apiKey: 'AIzaSyB8HvxU7VhR9mWiSvyFu3XXXbmLfoKz9M0',
    authDomain: 'aion2boss.firebaseapp.com',
    databaseURL: 'https://aion2boss-default-rtdb.firebaseio.com',
    projectId: 'aion2boss',
    storageBucket: 'aion2boss.firebasestorage.app',
    messagingSenderId: '985334026286',
    appId: '1:985334026286:web:4959921d864700b5cf0fbf'
  },
  UI: {
    WARNING_MS: 300000
  },
  MAP: {
    FLY_SCALE: 1.6,
    MIN_SCALE: 0.3,
    MAX_SCALE: 5,
    FLY_DURATION_MS: 450
  },
  LIMITS: {
    NAME: 20,
    LOC: 100,
    INFO: 400
  }
}

export const emptyForm = {
  name: '',
  color: '#ffadad',
  race: '마족',
  location: '',
  kibelisk: '',
  drop: '',
  interval: '',
  regionIndex: '',
  bossCode: '',
  mapX: '',
  mapY: ''
}

export { pad2 }

export const PARTICIPANT_NICKNAME_MAX_LENGTH = 8
export const ALERT_MARKS = [
  { id: 'm20', ms: 20 * 60000, label: '20분 전', notice: '20분 남았습니다.' },
  { id: 'm10', ms: 10 * 60000, label: '10분 전', notice: '10분 남았습니다.' },
  { id: 'm5', ms: 5 * 60000, label: '5분 전', notice: '5분 남았습니다.' },
  { id: 'm1', ms: 62000, label: '1분 전', notice: '1분 남았습니다.' },
  { id: 's30', ms: 32000, label: '30초 전', notice: '30초 남았습니다.' },
  { id: 's10', ms: 12000, label: '10초 전', notice: '10초 남았습니다.' },
  { id: 's5', ms: 7000, label: '5초 전', notice: '5초 남았습니다.' }
]
export const ALERT_ARM_THRESHOLD_MS = 62000
export const DEFAULT_ALERT_PREFS = {
  m20: false,
  m10: true,
  m5: false,
  m1: true,
  s30: true,
  s10: true,
  s5: true
}
const CYCLE_DRIFT_CORRECTION_MS = 10000
export const DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC = 40
export const ADJACENT_BOSS_THRESHOLD_MIN_SEC = 1
export const ADJACENT_BOSS_THRESHOLD_MAX_SEC = 600
export const ROOM_CREATION_ENABLED = false
export const ROOM_CREATION_DISABLED_MESSAGE = '현재 새 방 생성은 일시적으로 비활성화되어 있습니다. 기존 방만 입장할 수 있습니다.'
export const DEFAULT_PASSWORD_CHANGE_KEY = '0110'
export const COPY_ORDER_WINDOW_MS = 30 * 60000
const DEFAULT_CHASE_COLUMN_WIDTH = 118
const MIN_CHASE_COLUMN_WIDTH = DEFAULT_CHASE_COLUMN_WIDTH
const LEGACY_CHASE_COLUMN_WIDTHS = new Set([148, 164])
export const CHASE_TEAM_OPTIONS = [
  { value: 1, label: '1팀', emoji: '1️⃣' },
  { value: 2, label: '2팀', emoji: '2️⃣' },
  { value: 3, label: '3팀', emoji: '3️⃣' },
  { value: 4, label: '4팀', emoji: '4️⃣' }
]
const CHASE_TEAM_SET = new Set(CHASE_TEAM_OPTIONS.map((team) => team.value))
export const BASE_COLUMN_ORDER = ['alert', 'name', 'info', 'location', 'kibelisk', 'remaining', 'next', 'chase']
export const COLUMN_LABELS = {
  kibelisk: '키벨리스크',
  alert: '알림',
  name: '보스명',
  info: '정보',
  location: '위치',
  remaining: '남은 시간',
  next: '다음 젠 시간',
  chase: '추격팀'
}
export const DEFAULT_COLUMN_PREFS = {
  kibelisk: false,
  alert: true,
  name: true,
  info: false,
  location: true,
  remaining: true,
  next: true
}
export const DEFAULT_COLUMN_WIDTHS = {
  kibelisk: 110,
  alert: 96,
  name: 180,
  info: 240,
  location: 190,
  remaining: 140,
  next: 140,
  chase: DEFAULT_CHASE_COLUMN_WIDTH,
  manage: 110
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function diffToClock(ms) {
  const safe = Math.max(0, ms)
  const h = Math.floor(safe / 3600000)
  const m = Math.floor((safe % 3600000) / 60000)
  const s = Math.floor((safe % 60000) / 1000)
  return { h, m, s }
}

export function getSpawnInfo(boss, now) {
  if (!boss?.nextSpawnTimestamp || !boss?.interval) {
    return { time: null }
  }

  const intervalMs = Number(boss.interval) * 3600000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { time: null }
  }

  let nextTime = Number(boss.nextSpawnTimestamp)

  if (nextTime <= now) {
    const correctedIntervalMs = intervalMs + CYCLE_DRIFT_CORRECTION_MS
    const diff = now - nextTime
    const cycles = Math.floor(diff / correctedIntervalMs) + 1
    nextTime += cycles * correctedIntervalMs
  }

  return { time: nextTime }
}

export function isSyncNeeded(boss, now) {
  if (!boss?.interval || !boss?.nextSpawnTimestamp) return false
  return now >= Number(boss.nextSpawnTimestamp)
}

export function getBossList(bosses, now) {
  return Object.entries(bosses)
    .map(([key, boss]) => {
      const spawn = getSpawnInfo(boss, now)
      return {
        key,
        ...boss,
        alertEnabled: boss?.alertEnabled !== false,
        effectiveTime: spawn.time ?? Number.MAX_SAFE_INTEGER
      }
    })
    .sort((a, b) => a.effectiveTime - b.effectiveTime)
}

export function hasMapPoint(boss) {
  return boss?.mapX !== '' && boss?.mapY !== '' && boss?.mapX != null && boss?.mapY != null
}

function createPresenceId(prefix) {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getOrCreatePresenceId(storageKey, prefix, readStorage, writeStorage) {
  const existing = readStorage(storageKey)
  if (existing) return existing

  const nextId = createPresenceId(prefix)
  writeStorage(storageKey, nextId)
  return nextId
}

export function getPresenceSessionId() {
  return getOrCreatePresenceId(
    'aion2boss_presence_session_id',
    'presence',
    readSessionStorage,
    writeSessionStorage
  )
}

export function getPresenceBrowserId() {
  return getOrCreatePresenceId(
    'aion2boss_presence_browser_id',
    'presence-browser',
    readLocalStorage,
    writeLocalStorage
  )
}

function isLegacyPresenceEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return ['role', 'nickname', 'joinedAt', 'updatedAt'].some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function normalizePresenceLeaf(id, value) {
  return {
    id,
    nickname: normalizeParticipantNickname(value?.nickname || ''),
    role: value?.role === 'admin' ? 'admin' : 'guest',
    joinedAt: Number(value?.joinedAt) || 0,
    updatedAt: Number(value?.updatedAt) || 0
  }
}

export function buildParticipantEntriesFromPresence(presence) {
  return Object.entries(presence || {})
    .map(([id, value]) => {
      if (isLegacyPresenceEntry(value)) {
        return normalizePresenceLeaf(id, value)
      }

      const tabEntries = Object.entries(value || {})
        .map(([tabId, tabValue]) => normalizePresenceLeaf(tabId, tabValue))
        .filter((entry) => entry.joinedAt || entry.updatedAt || entry.nickname)

      if (!tabEntries.length) return null

      const representative = tabEntries.reduce((best, entry) => {
        if (!best) return entry
        const bestStamp = best.updatedAt || best.joinedAt || 0
        const entryStamp = entry.updatedAt || entry.joinedAt || 0
        if (entryStamp > bestStamp) return entry
        if (entryStamp === bestStamp && entry.joinedAt > best.joinedAt) return entry
        return best
      }, null)

      const joinedAt = tabEntries.reduce((earliest, entry) => {
        if (!entry.joinedAt) return earliest
        return entry.joinedAt < earliest ? entry.joinedAt : earliest
      }, Number.POSITIVE_INFINITY)

      return {
        id,
        nickname: representative?.nickname || '',
        role: representative?.role || 'guest',
        joinedAt: Number.isFinite(joinedAt) ? joinedAt : 0,
        updatedAt: representative?.updatedAt || representative?.joinedAt || 0,
        tabCount: tabEntries.length
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt
      return a.id.localeCompare(b.id)
    })
}

export function normalizeParticipantNickname(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').slice(0, PARTICIPANT_NICKNAME_MAX_LENGTH)
}

export function getParticipantDisplayName(participant) {
  const nickname = normalizeParticipantNickname(participant?.nickname || '').trim()
  return nickname || '별명 미설정'
}

export async function hashRoomPassword(password) {
  if (!window.crypto?.subtle) {
    throw new Error('Room password hashing requires Web Crypto support.')
  }

  const normalized = String(password ?? '').trim()
  const encoded = new TextEncoder().encode(normalized)
  const digest = await window.crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hasRoomPassword(settings) {
  return typeof settings?.passwordHash === 'string' && settings.passwordHash.length > 0
}

export function getPointerClientX(event) {
  if (typeof event.clientX === 'number') return event.clientX
  if (event.touches?.length) return event.touches[0].clientX
  if (event.changedTouches?.length) return event.changedTouches[0].clientX
  return null
}

export function normalizeAdjacentBossThresholdSec(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC
  return Math.min(
    ADJACENT_BOSS_THRESHOLD_MAX_SEC,
    Math.max(ADJACENT_BOSS_THRESHOLD_MIN_SEC, Math.round(parsed))
  )
}

export function normalizeKibeliskValue(value) {
  return String(value ?? '').replace(/[^\d]/g, '')
}

export function normalizeChaseTeams(value) {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value
      .map((team) => Number(team))
      .filter((team) => CHASE_TEAM_SET.has(team))
  )].sort((a, b) => a - b)
}

export function filterBossesByRace(bosses, raceFilter) {
  if (raceFilter === '모두') return bosses
  return bosses.filter((boss) => (boss.race || '마족') === raceFilter)
}

export function filterBossesByParty(bosses, chaseModeEnabled, partyFilter) {
  if (!chaseModeEnabled || !partyFilter) return bosses
  return bosses.filter((boss) => {
    const chaseTeams = normalizeChaseTeams(boss.chaseTeams)
    return !chaseTeams.length || chaseTeams.includes(partyFilter)
  })
}

export function getCopyEligibleBosses(bosses, now, windowMs) {
  return bosses.filter((boss) => {
    if (boss.alertEnabled === false) return false
    const spawn = getSpawnInfo(boss, now)
    return Number.isFinite(spawn.time) && spawn.time - now <= windowMs
  })
}

export function normalizeChaseColumnWidth(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CHASE_COLUMN_WIDTH
  if (LEGACY_CHASE_COLUMN_WIDTHS.has(parsed)) return DEFAULT_CHASE_COLUMN_WIDTH
  return Math.max(Math.round(parsed), MIN_CHASE_COLUMN_WIDTH)
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = hue / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hh >= 0 && hh < 1) {
    r1 = c
    g1 = x
  } else if (hh >= 1 && hh < 2) {
    r1 = x
    g1 = c
  } else if (hh >= 2 && hh < 3) {
    g1 = c
    b1 = x
  } else if (hh >= 3 && hh < 4) {
    g1 = x
    b1 = c
  } else if (hh >= 4 && hh < 5) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }

  const m = lightness / 100 - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  }
}

function getRelativeLuminance(rgb) {
  const toLinear = (channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

function getContrastRatio(rgbA, rgbB) {
  const luminanceA = getRelativeLuminance(rgbA)
  const luminanceB = getRelativeLuminance(rgbB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return (lighter + 0.05) / (darker + 0.05)
}

function getColorDistance(rgbA, rgbB) {
  return Math.sqrt(
    (rgbA.r - rgbB.r) ** 2 +
    (rgbA.g - rgbB.g) ** 2 +
    (rgbA.b - rgbB.b) ** 2
  )
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}

function buildChaseRowPalette() {
  const white = { r: 255, g: 255, b: 255 }
  const usedColors = []
  const palette = []

  for (let idx = 0; idx < 15; idx += 1) {
    let hue = (idx * 137.508) % 360
    let saturation = 58 + (idx % 3) * 6
    let lightness = 28 - (idx % 4)
    let rgb = hslToRgb(hue, saturation, lightness)

    for (let attempt = 0; attempt < 36; attempt += 1) {
      const contrastOk = getContrastRatio(rgb, white) >= 4.8
      const distinctEnough = usedColors.every((usedColor) => getColorDistance(usedColor, rgb) >= 52)
      if (contrastOk && distinctEnough) break

      if (!contrastOk) {
        lightness = Math.max(18, lightness - 2)
      } else {
        hue = (hue + 23) % 360
        saturation = Math.min(78, saturation + 1)
      }

      rgb = hslToRgb(hue, saturation, lightness)
    }

    usedColors.push(rgb)
    palette.push(rgbToCss(rgb))
  }

  return palette
}

const CHASE_ROW_COLOR_PALETTE = buildChaseRowPalette()

export function formatChaseTeams(teams) {
  const normalized = normalizeChaseTeams(teams)
  if (!normalized.length) return '추격팀'
  return normalized
    .map((team) => CHASE_TEAM_OPTIONS.find((option) => option.value === team)?.emoji || `${team}`)
    .join(' ')
}

export function getChaseTeamEmoji(team) {
  return CHASE_TEAM_OPTIONS.find((option) => option.value === team)?.emoji || `${team}`
}

export function describeChaseTeams(teams) {
  const normalized = normalizeChaseTeams(teams)
  if (!normalized.length) return '추격팀 미설정'
  return normalized.map((team) => `${team}팀`).join(', ')
}

export function buildChaseCopyText(items, getValue) {
  const groups = new Map()
  const groupOrder = []

  items.forEach((item) => {
    const value = String(getValue(item) ?? '').trim()
    if (!value) return

    const teams = normalizeChaseTeams(item?.chaseTeams)
    const key = teams.join(',')
    if (!groups.has(key)) {
      groups.set(key, { teams, values: [] })
      groupOrder.push(key)
    }

    groups.get(key).values.push(value)
  })

  return groupOrder
    .map((key) => {
      const group = groups.get(key)
      if (!group || !group.values.length) return ''

      const valuesText = group.values.join(',')
      if (!group.teams.length) return valuesText
      return `[${group.teams.join(',')}팀-${valuesText}]`
    })
    .filter(Boolean)
    .join(' ')
}

export function getChaseRowBackground(teams) {
  const normalized = normalizeChaseTeams(teams)
  if (!normalized.length) return ''

  const mask = normalized.reduce((bits, team) => bits | (1 << (team - 1)), 0)
  return CHASE_ROW_COLOR_PALETTE[(mask - 1) % CHASE_ROW_COLOR_PALETTE.length]
}

export function sanitizeSharedMemoHtml(html) {
  if (!html) return ''

  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return String(html).trim()
  }

  const parser = new window.DOMParser()
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
  const source = doc.body.firstElementChild
  if (!source) return ''

  const sanitizeNode = (node) => {
    if (node.nodeType === 3) {
      return doc.createTextNode(node.textContent || '')
    }

    if (node.nodeType !== 1) {
      return null
    }

    const tag = node.tagName.toUpperCase()
    const fragment = doc.createDocumentFragment()
    Array.from(node.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child)
      if (sanitizedChild) fragment.appendChild(sanitizedChild)
    })

    if (tag === 'BR') {
      return doc.createElement('br')
    }

    const normalizedTag = tag === 'STRONG'
      ? 'b'
      : tag === 'EM'
        ? 'i'
        : tag === 'DIV'
          ? 'p'
          : tag.toLowerCase()

    if (!['p', 'b', 'i', 'u', 's', 'ul', 'ol', 'li'].includes(normalizedTag)) {
      return fragment
    }

    const el = doc.createElement(normalizedTag)
    el.appendChild(fragment)
    return el
  }

  const clean = doc.createElement('div')
  Array.from(source.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(child)
    if (sanitizedChild) clean.appendChild(sanitizedChild)
  })

  return clean.innerHTML
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<li>\s*<\/li>/gi, '')
    .replace(/<p><br><\/p>/gi, '')
    .replace(/\u200b/gi, '')
    .trim()
}

export function getSharedMemoPlainText(html) {
  const sanitized = sanitizeSharedMemoHtml(html)
  return sanitized
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u200b/gi, '')
}

export function hasSharedMemoContent(html) {
  return getSharedMemoPlainText(html).trim().length > 0
}

export const VIEW_BOSS = 'boss'
export const VIEW_RACING = 'racing'
export const TOPBAR_LABEL_MINI_GAME = '미니게임'
export const TOPBAR_LABEL_TO_BOSS = '필보관리'
export const MINI_GAME_TARGET_INTERNAL = 'internal'
export const MINI_GAME_TARGET_EXTERNAL = 'external'
export const MINI_GAME_ITEMS = [
  {
    id: 'racing',
    label: '달려달려',
    description: '기존 달려달려 미니게임으로 현재 페이지에서 이동합니다.',
    target: MINI_GAME_TARGET_INTERNAL,
    view: VIEW_RACING
  },
  {
    id: 'horse-coffee',
    label: 'horse.coffee',
    description: 'horse.coffee 페이지를 새 탭에서 엽니다.',
    target: MINI_GAME_TARGET_EXTERNAL,
    url: 'https://horsecoffee.synology.me/'
  },
  {
    id: 'roulette',
    label: 'roulette',
    description: 'roulette 페이지를 새 탭에서 엽니다.',
    target: MINI_GAME_TARGET_EXTERNAL,
    url: 'https://lazygyu.github.io/roulette/'
  }
]
export const EMPTY_CHASE_TEAM_DIALOG = {
  open: false,
  key: '',
  name: '',
  selectedTeams: []
}
export const EMPTY_ROOM_SETTINGS_DIALOG = {
  open: false,
  roomName: '',
  passwordChangeKey: '',
  password: '',
  showPassword: false,
  saving: false
}
export const EMPTY_PARTICIPANT_LIST_DIALOG = {
  open: false
}
export const DEFAULT_SHARED_MEMO_SIZE = {
  width: 380,
  height: 320
}
export const MIN_SHARED_MEMO_WIDTH = 280
export const MIN_SHARED_MEMO_HEIGHT = 220
export const MAX_SHARED_MEMO_WIDTH = 620
export const MAX_SHARED_MEMO_HEIGHT = 520
export const SHARED_MEMO_MAX_LENGTH = 3000
export const SHARED_MEMO_TOOLS = [
  { command: 'bold', label: 'B', title: '굵게' },
  { command: 'italic', label: 'I', title: '기울임' },
  { command: 'underline', label: 'U', title: '밑줄' },
  { command: 'clearAll', label: '전체 지우기', title: '내용 전체 지우기' }
]
