import {
  BASE_COLUMN_ORDER,
  DEFAULT_ALERT_PREFS,
  DEFAULT_COLUMN_PREFS,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_SHARED_MEMO_SIZE,
  MAX_SHARED_MEMO_HEIGHT,
  MAX_SHARED_MEMO_WIDTH,
  MIN_SHARED_MEMO_HEIGHT,
  MIN_SHARED_MEMO_WIDTH,
  normalizeChaseColumnWidth,
  normalizeParticipantNickname
} from './appCore'

const TTS_STORAGE_KEY = 'aion2boss_tts_enabled'
const TTS_NOTICE_DISMISS_KEY = 'aion2boss_tts_notice_dismissed'
const OVERLAY_SCALE_STORAGE_KEY = 'aion2boss_overlay_scale'
const ALERT_PREF_COOKIE_KEY = 'aion2boss_alert_prefs'
const SHARED_MEMO_SIZE_COOKIE_KEY = 'aion2boss_shared_memo_size'
const PARTICIPANT_NICKNAME_STORAGE_KEY = 'aion2boss_participant_nickname'
const RECENT_ROOM_STORAGE_KEY = 'aion2boss_recent_room'
const COLUMN_PREF_COOKIE_KEY = 'aion2boss_column_prefs'
const COLUMN_WIDTH_COOKIE_KEY = 'aion2boss_column_widths'
const COLUMN_ORDER_COOKIE_KEY = 'aion2boss_column_order'
const RACE_FILTER_COOKIE_KEY = 'aion2boss_race_filter'

function readCookie(name) {
  const key = `${name}=`
  const found = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(key))
  return found ? decodeURIComponent(found.slice(key.length)) : ''
}

function normalizeOverlayScaleValue(value) {
  if (value == null || value === '') return 1
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue)) return 1
  return Math.min(1, Math.max(0.5, Math.round(nextValue * 100) / 100))
}

export function loadParticipantNickname() {
  try {
    return normalizeParticipantNickname(window.localStorage.getItem(PARTICIPANT_NICKNAME_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

export function saveParticipantNickname(nickname) {
  try {
    window.localStorage.setItem(PARTICIPANT_NICKNAME_STORAGE_KEY, normalizeParticipantNickname(nickname))
  } catch {
    // Ignore storage sync failures and keep nickname in memory.
  }
}

export function loadOverlayScale() {
  try {
    return normalizeOverlayScaleValue(window.localStorage.getItem(OVERLAY_SCALE_STORAGE_KEY))
  } catch {
    return 1
  }
}

export function saveOverlayScale(scale) {
  try {
    window.localStorage.setItem(OVERLAY_SCALE_STORAGE_KEY, String(normalizeOverlayScaleValue(scale)))
  } catch {
    // Ignore local storage failures and keep overlay scale in memory.
  }
}

export function loadRecentRoomEntry() {
  try {
    const raw = window.localStorage.getItem(RECENT_ROOM_STORAGE_KEY)
    if (!raw) {
      return {
        room: '',
        password: '',
        role: 'admin'
      }
    }

    const parsed = JSON.parse(raw)
    return {
      room: typeof parsed?.room === 'string' ? parsed.room.trim() : '',
      password: typeof parsed?.password === 'string' ? parsed.password : '',
      role: parsed?.role === 'guest' ? 'guest' : 'admin'
    }
  } catch {
    return {
      room: '',
      password: '',
      role: 'admin'
    }
  }
}

export function saveRecentRoomEntry(entry) {
  try {
    const normalized = {
      room: typeof entry?.room === 'string' ? entry.room.trim() : '',
      password: typeof entry?.password === 'string' ? entry.password : '',
      role: entry?.role === 'guest' ? 'guest' : 'admin'
    }

    if (!normalized.room) {
      window.localStorage.removeItem(RECENT_ROOM_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(RECENT_ROOM_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Ignore local storage failures and keep room info in memory.
  }
}

export function loadTtsNoticeDismissed() {
  try {
    return window.localStorage.getItem(TTS_NOTICE_DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveTtsNoticeDismissed(dismissed) {
  try {
    window.localStorage.setItem(TTS_NOTICE_DISMISS_KEY, dismissed ? 'true' : 'false')
  } catch {
    // Ignore local storage failures and keep state in memory.
  }
}

export function loadColumnPrefsFromCookie() {
  try {
    const raw = readCookie(COLUMN_PREF_COOKIE_KEY)
    if (!raw) return DEFAULT_COLUMN_PREFS
    const parsed = JSON.parse(raw)
    return {
      alert: parsed?.alert !== false,
      name: parsed?.name !== false,
      info: parsed?.info !== false,
      location: parsed?.location !== false,
      kibelisk: parsed?.kibelisk === true,
      remaining: parsed?.remaining !== false,
      next: parsed?.next !== false
    }
  } catch {
    return DEFAULT_COLUMN_PREFS
  }
}

export function saveColumnPrefsToCookie(prefs) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_PREF_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=${expires}; SameSite=Lax`
}

export function loadColumnWidthsFromCookie() {
  try {
    const raw = readCookie(COLUMN_WIDTH_COOKIE_KEY)
    if (!raw) return DEFAULT_COLUMN_WIDTHS
    const parsed = JSON.parse(raw)
    return {
      alert: Number.isFinite(parsed?.alert) ? parsed.alert : DEFAULT_COLUMN_WIDTHS.alert,
      name: Number.isFinite(parsed?.name) ? parsed.name : DEFAULT_COLUMN_WIDTHS.name,
      info: Number.isFinite(parsed?.info) ? parsed.info : DEFAULT_COLUMN_WIDTHS.info,
      location: Number.isFinite(parsed?.location) ? parsed.location : DEFAULT_COLUMN_WIDTHS.location,
      kibelisk: Number.isFinite(parsed?.kibelisk) ? parsed.kibelisk : DEFAULT_COLUMN_WIDTHS.kibelisk,
      remaining: Number.isFinite(parsed?.remaining) ? parsed.remaining : DEFAULT_COLUMN_WIDTHS.remaining,
      next: Number.isFinite(parsed?.next) ? parsed.next : DEFAULT_COLUMN_WIDTHS.next,
      chase: normalizeChaseColumnWidth(parsed?.chase),
      manage: Number.isFinite(parsed?.manage) ? parsed.manage : DEFAULT_COLUMN_WIDTHS.manage
    }
  } catch {
    return DEFAULT_COLUMN_WIDTHS
  }
}

export function saveColumnWidthsToCookie(widths) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_WIDTH_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(widths))}; path=/; max-age=${expires}; SameSite=Lax`
}

export function hasColumnWidthCookie() {
  return Boolean(readCookie(COLUMN_WIDTH_COOKIE_KEY))
}

export function loadColumnOrderFromCookie() {
  try {
    const raw = readCookie(COLUMN_ORDER_COOKIE_KEY)
    if (!raw) return BASE_COLUMN_ORDER
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return BASE_COLUMN_ORDER
    const known = parsed.filter((key) => BASE_COLUMN_ORDER.includes(key))
    const missing = BASE_COLUMN_ORDER.filter((key) => !known.includes(key))
    return [...known, ...missing]
  } catch {
    return BASE_COLUMN_ORDER
  }
}

export function saveColumnOrderToCookie(order) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_ORDER_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(order))}; path=/; max-age=${expires}; SameSite=Lax`
}

export function loadRaceFilterFromCookie() {
  const raw = readCookie(RACE_FILTER_COOKIE_KEY)
  if (raw === '천족' || raw === '마족' || raw === '기타' || raw === '모두') {
    return raw
  }
  return '모두'
}

export function saveRaceFilterToCookie(filterValue) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${RACE_FILTER_COOKIE_KEY}=${encodeURIComponent(filterValue)}; path=/; max-age=${expires}; SameSite=Lax`
}

export function loadTtsEnabledFromCookie() {
  const raw = readCookie(TTS_STORAGE_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return window.localStorage.getItem(TTS_STORAGE_KEY) === 'true'
}

export function saveTtsEnabledToCookie(enabled) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${TTS_STORAGE_KEY}=${encodeURIComponent(enabled ? 'true' : 'false')}; path=/; max-age=${expires}; SameSite=Lax`
}

export function loadAlertPrefsFromCookie() {
  try {
    const raw = readCookie(ALERT_PREF_COOKIE_KEY)
    if (!raw) return DEFAULT_ALERT_PREFS
    const parsed = JSON.parse(raw)
    return {
      m20: parsed?.m20 === true,
      m10: parsed?.m10 !== false,
      m5: parsed?.m5 === true,
      m1: parsed?.m1 !== false,
      s30: parsed?.s30 !== false,
      s10: parsed?.s10 !== false,
      s5: parsed?.s5 !== false
    }
  } catch {
    return DEFAULT_ALERT_PREFS
  }
}

export function saveAlertPrefsToCookie(prefs) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${ALERT_PREF_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=${expires}; SameSite=Lax`
}

export function getSharedMemoSizeBounds() {
  if (typeof window === 'undefined') {
    return {
      minWidth: MIN_SHARED_MEMO_WIDTH,
      maxWidth: MAX_SHARED_MEMO_WIDTH,
      minHeight: MIN_SHARED_MEMO_HEIGHT,
      maxHeight: MAX_SHARED_MEMO_HEIGHT
    }
  }

  return {
    minWidth: MIN_SHARED_MEMO_WIDTH,
    maxWidth: Math.max(MIN_SHARED_MEMO_WIDTH, Math.min(MAX_SHARED_MEMO_WIDTH, window.innerWidth - 32)),
    minHeight: MIN_SHARED_MEMO_HEIGHT,
    maxHeight: Math.max(MIN_SHARED_MEMO_HEIGHT, Math.min(MAX_SHARED_MEMO_HEIGHT, window.innerHeight - 140))
  }
}

export function normalizeSharedMemoSize(value) {
  const bounds = getSharedMemoSizeBounds()
  const width = Number(value?.width)
  const height = Number(value?.height)
  const nextWidth = Number.isFinite(width) ? Math.round(width) : DEFAULT_SHARED_MEMO_SIZE.width
  const nextHeight = Number.isFinite(height) ? Math.round(height) : DEFAULT_SHARED_MEMO_SIZE.height

  return {
    width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, nextWidth)),
    height: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, nextHeight))
  }
}

export function loadSharedMemoSizeFromCookie() {
  try {
    const raw = readCookie(SHARED_MEMO_SIZE_COOKIE_KEY)
    if (!raw) return normalizeSharedMemoSize(DEFAULT_SHARED_MEMO_SIZE)
    return normalizeSharedMemoSize(JSON.parse(raw))
  } catch {
    return normalizeSharedMemoSize(DEFAULT_SHARED_MEMO_SIZE)
  }
}

export function saveSharedMemoSizeToCookie(size) {
  const expires = 60 * 60 * 24 * 365
  const normalized = normalizeSharedMemoSize(size)
  document.cookie = `${SHARED_MEMO_SIZE_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(normalized))}; path=/; max-age=${expires}; SameSite=Lax`
}

export function getSharedMemoResizeCursor(direction) {
  if (direction === 'top') return 'ns-resize'
  if (direction === 'left') return 'ew-resize'
  return 'nwse-resize'
}
