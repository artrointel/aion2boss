import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getDatabase, onValue, ref, remove, update } from 'firebase/database'
import racingBackgroundImage from './assets/racing-background.svg'
import racingDizzyCliffBackgroundImage from './assets/racing-background-dizzy-cliff.svg'
import racingLaneSceneryCliff from './assets/racing-lane-scenery-cliff.svg'
import racingLaneSceneryMeadow from './assets/racing-lane-scenery-meadow.svg'
import racingTrackPatternCliff from './assets/racing-track-pattern-cliff.svg'
import racingTrackPatternMeadow from './assets/racing-track-pattern-meadow.svg'

const CONFIG = {
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

const app = initializeApp(CONFIG.FIREBASE)
const db = getDatabase(app)

const emptyForm = {
  name: '',
  color: '#ffadad',
  race: '마족',
  location: '',
  drop: '',
  interval: '',
  mapX: '',
  mapY: ''
}

const pad2 = (num) => String(num).padStart(2, '0')
const TTS_STORAGE_KEY = 'aion2boss_tts_enabled'
const TTS_NOTICE_DISMISS_KEY = 'aion2boss_tts_notice_dismissed'
const ALERT_PREF_COOKIE_KEY = 'aion2boss_alert_prefs'
const ALERT_MARKS = [
  { id: 'm20', ms: 20 * 60000, label: '20분 전', notice: '20분 남았습니다.' },
  { id: 'm10', ms: 10 * 60000, label: '10분 전', notice: '10분 남았습니다.' },
  { id: 'm5', ms: 5 * 60000, label: '5분 전', notice: '5분 남았습니다.' },
  { id: 'm1', ms: 62000, label: '1분 전', notice: '1분 남았습니다.' },
  { id: 's30', ms: 32000, label: '30초 전', notice: '30초 남았습니다.' },
  { id: 's10', ms: 12000, label: '10초 전', notice: '10초 남았습니다.' },
  { id: 's5', ms: 7000, label: '5초 전', notice: '5초 남았습니다.' }
]
const ALERT_ARM_THRESHOLD_MS = 62000
const DEFAULT_ALERT_PREFS = {
  m20: false,
  m10: true,
  m5: false,
  m1: true,
  s30: true,
  s10: true,
  s5: true
}
const CYCLE_DRIFT_CORRECTION_MS = 10000
const COLUMN_PREF_COOKIE_KEY = 'aion2boss_column_prefs'
const COLUMN_WIDTH_COOKIE_KEY = 'aion2boss_column_widths'
const COLUMN_ORDER_COOKIE_KEY = 'aion2boss_column_order'
const RACE_FILTER_COOKIE_KEY = 'aion2boss_race_filter'
const DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC = 40
const ADJACENT_BOSS_THRESHOLD_MIN_SEC = 1
const ADJACENT_BOSS_THRESHOLD_MAX_SEC = 600
const BASE_COLUMN_ORDER = ['alert', 'name', 'info', 'location', 'remaining', 'next']
const COLUMN_LABELS = {
  alert: '알림',
  name: '보스명',
  info: '정보',
  location: '위치',
  remaining: '남은 시간',
  next: '다음 젠 시간'
}
const DEFAULT_COLUMN_PREFS = {
  alert: true,
  name: true,
  info: false,
  location: true,
  remaining: true,
  next: true
}
const DEFAULT_COLUMN_WIDTHS = {
  alert: 96,
  name: 180,
  info: 240,
  location: 190,
  remaining: 140,
  next: 140,
  manage: 110
}

function formatDateTime(timestamp) {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function diffToClock(ms) {
  const safe = Math.max(0, ms)
  const h = Math.floor(safe / 3600000)
  const m = Math.floor((safe % 3600000) / 60000)
  const s = Math.floor((safe % 60000) / 1000)
  return { h, m, s }
}

function getSpawnInfo(boss, now) {
  if (!boss?.nextSpawnTimestamp || !boss?.interval) {
    return { time: null }
  }

  const intervalMs = Number(boss.interval) * 3600000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { time: null }
  }

  let nextTime = Number(boss.nextSpawnTimestamp)

  if (nextTime <= now) {
    // First spawn uses the manually synced time.
    // After that point, apply empirical +10s correction per spawn cycle.
    const correctedIntervalMs = intervalMs + CYCLE_DRIFT_CORRECTION_MS
    const diff = now - nextTime
    const cycles = Math.floor(diff / correctedIntervalMs) + 1
    nextTime += cycles * correctedIntervalMs
  }

  return { time: nextTime }
}

function isSyncNeeded(boss, now) {
  if (!boss?.interval || !boss?.nextSpawnTimestamp) return false
  return now >= Number(boss.nextSpawnTimestamp)
}

function getBossList(bosses, now) {
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

function hasMapPoint(boss) {
  return boss?.mapX !== '' && boss?.mapY !== '' && boss?.mapX != null && boss?.mapY != null
}

function readCookie(name) {
  const key = `${name}=`
  const found = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(key))
  return found ? decodeURIComponent(found.slice(key.length)) : ''
}

function loadColumnPrefsFromCookie() {
  try {
    const raw = readCookie(COLUMN_PREF_COOKIE_KEY)
    if (!raw) return DEFAULT_COLUMN_PREFS
    const parsed = JSON.parse(raw)
    return {
      alert: parsed?.alert !== false,
      name: parsed?.name !== false,
      info: parsed?.info !== false,
      location: parsed?.location !== false,
      remaining: parsed?.remaining !== false,
      next: parsed?.next !== false
    }
  } catch {
    return DEFAULT_COLUMN_PREFS
  }
}

function saveColumnPrefsToCookie(prefs) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_PREF_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=${expires}; SameSite=Lax`
}

function loadColumnWidthsFromCookie() {
  try {
    const raw = readCookie(COLUMN_WIDTH_COOKIE_KEY)
    if (!raw) return DEFAULT_COLUMN_WIDTHS
    const parsed = JSON.parse(raw)
    return {
      alert: Number.isFinite(parsed?.alert) ? parsed.alert : DEFAULT_COLUMN_WIDTHS.alert,
      name: Number.isFinite(parsed?.name) ? parsed.name : DEFAULT_COLUMN_WIDTHS.name,
      info: Number.isFinite(parsed?.info) ? parsed.info : DEFAULT_COLUMN_WIDTHS.info,
      location: Number.isFinite(parsed?.location) ? parsed.location : DEFAULT_COLUMN_WIDTHS.location,
      remaining: Number.isFinite(parsed?.remaining) ? parsed.remaining : DEFAULT_COLUMN_WIDTHS.remaining,
      next: Number.isFinite(parsed?.next) ? parsed.next : DEFAULT_COLUMN_WIDTHS.next,
      manage: Number.isFinite(parsed?.manage) ? parsed.manage : DEFAULT_COLUMN_WIDTHS.manage
    }
  } catch {
    return DEFAULT_COLUMN_WIDTHS
  }
}

function saveColumnWidthsToCookie(widths) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_WIDTH_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(widths))}; path=/; max-age=${expires}; SameSite=Lax`
}

function hasColumnWidthCookie() {
  return Boolean(readCookie(COLUMN_WIDTH_COOKIE_KEY))
}

function loadColumnOrderFromCookie() {
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

function saveColumnOrderToCookie(order) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${COLUMN_ORDER_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(order))}; path=/; max-age=${expires}; SameSite=Lax`
}

function loadRaceFilterFromCookie() {
  const raw = readCookie(RACE_FILTER_COOKIE_KEY)
  if (raw === '천족' || raw === '마족' || raw === '기타' || raw === '모두') {
    return raw
  }
  return '모두'
}

function saveRaceFilterToCookie(filterValue) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${RACE_FILTER_COOKIE_KEY}=${encodeURIComponent(filterValue)}; path=/; max-age=${expires}; SameSite=Lax`
}

function loadTtsEnabledFromCookie() {
  const raw = readCookie(TTS_STORAGE_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  // Backward compatibility: migrate old localStorage value if present.
  return window.localStorage.getItem(TTS_STORAGE_KEY) === 'true'
}

function saveTtsEnabledToCookie(enabled) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${TTS_STORAGE_KEY}=${encodeURIComponent(enabled ? 'true' : 'false')}; path=/; max-age=${expires}; SameSite=Lax`
}

function loadAlertPrefsFromCookie() {
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

function saveAlertPrefsToCookie(prefs) {
  const expires = 60 * 60 * 24 * 365
  document.cookie = `${ALERT_PREF_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=${expires}; SameSite=Lax`
}

function getPointerClientX(event) {
  if (typeof event.clientX === 'number') return event.clientX
  if (event.touches?.length) return event.touches[0].clientX
  if (event.changedTouches?.length) return event.changedTouches[0].clientX
  return null
}

function normalizeAdjacentBossThresholdSec(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC
  return Math.min(
    ADJACENT_BOSS_THRESHOLD_MAX_SEC,
    Math.max(ADJACENT_BOSS_THRESHOLD_MIN_SEC, Math.round(parsed))
  )
}

const VIEW_BOSS = 'boss'
const VIEW_RACING = 'racing'
const TOPBAR_LABEL_TO_RACING = '달려달려'
const TOPBAR_LABEL_TO_BOSS = '필보관리'
const PET_TYPE_RABBIT = 'rabbit'
const PET_TYPE_HORSE = 'horse'
const MAP_DEFAULT = 'default'
const MAP_DIZZY_CLIFF = 'dizzy_cliff'
const DEFAULT_RACE_DISTANCE = 1000
const TRACK_WORLD_PX_PER_DISTANCE = 1.55
const MIN_TRACK_WORLD_WIDTH_PX = 1400
const MAX_TRACK_WORLD_WIDTH_PX = 9600
const RACE_TICK_MS = 120
const INITIAL_SKILL_OFFSET_MAX_MS = 1000
const MAP_EVENT_TICK_MS = 1000
const STUN_DURATION_MS = 2000
const SHIELD_DURATION_MS = 3000
const BOULDER_STUN_DURATION_MS = 3000
const MUD_SLOW_DURATION_MS = 3000
const MUD_LIFETIME_MS = 9000
const DEFAULT_SKILL_TICK_MIN_SEC = 1
const DEFAULT_SKILL_TICK_MAX_SEC = 2
const MIN_SKILL_TICK_SEC = 0.2
const MAX_SKILL_TICK_SEC = 10
const DEFAULT_SKILL_CHANCE_PERCENT = {
  attack: 20,
  shield: 10,
  boost: 15,
  boulder: 20,
  mud: 20
}
const CARROT_PROJECTILE_SPEED_PX_PER_MS = 0.2925
const CARROT_PROJECTILE_DISTANCE_ACCEL_PER_PX_PER_MS = 0.00045
const CARROT_PROJECTILE_MAX_SPEED_PX_PER_MS = 1.55
const CARROT_HIT_DISTANCE_PX = 18
const RUNNER_EDGE_PADDING_PX = 28
const RUNNER_MIN_PROGRESS_PERCENT = 3
const RACING_BGM_STORAGE_KEY = 'aion2boss_racing_bgm_enabled'
const RACING_SFX_STORAGE_KEY = 'aion2boss_racing_sfx_enabled'
const RACING_AUTO_SCROLL_STORAGE_KEY = 'aion2boss_racing_auto_scroll_enabled'
const RACING_BGM_VOLUME_SCALE = 0.5
const RACING_SFX_VOLUME_SCALE = 0.7
const RACING_BGM_BASE_VOLUME = 0.36 * RACING_BGM_VOLUME_SCALE
const RACING_BGM_FADE_MS = 700
const APP_BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
const SOUND_SOURCES = {
  bgmWaiting: `${APP_BASE_URL}sound/bgm_waiting.mp3`,
  bgmPlaying: `${APP_BASE_URL}sound/bgm_playing.mp3`,
  throwing: `${APP_BASE_URL}sound/throwing.wav`,
  boost: `${APP_BASE_URL}sound/boost.wav`,
  stun: `${APP_BASE_URL}sound/stun.wav`,
  shield: `${APP_BASE_URL}sound/shield.wav`
}
const LANE_SCENERY_POSITIONS = [4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108]
const LANE_SCENERY_LANE_OFFSET_PERCENT = 7
const RACER_COLOR_PALETTE = [
  '#ff8da1',
  '#7fd7ff',
  '#ffd677',
  '#c2b2ff',
  '#81df9c',
  '#b8d6ff',
  '#ffb993',
  '#9dddc1'
]

function parsePetNamesInput(rawValue) {
  return rawValue
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

function createInitialRacers(names, previousRacers = []) {
  const previousById = new Map(previousRacers.map((racer) => [racer.id, racer]))
  return names.map((name, index) => {
    const id = `p${index + 1}`
    const previous = previousById.get(id)
    return {
      id,
      name,
      color: previous?.color || RACER_COLOR_PALETTE[index % RACER_COLOR_PALETTE.length],
      petType: previous?.petType || PET_TYPE_RABBIT,
      position: 0,
      speed: 0,
      status: '대기',
      finished: false,
      finishTime: null,
      baseSpeed: (55 + Math.random() * 12) * 0.7,
      stunUntil: 0,
      shieldUntil: 0,
      shieldCharges: 0,
      isShieldActive: false,
      boostUntil: 0,
      boostPendingCycle: false,
      runUntil: 0,
      slowUntil: 0,
      isSlowed: false,
      skillTickOffsetMs: Math.random() * INITIAL_SKILL_OFFSET_MAX_MS,
      nextSkillRollAt: 0,
      skillCooldownStartAt: 0,
      skillCooldownDurationMs: 0,
      cooldownPaused: false,
      cooldownPauseRemainingMs: 0,
      lastAilmentUntil: 0,
      eventText: '',
      eventTicks: 0,
      eventSeq: 0
    }
  })
}

function formatRaceDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  return `${(ms / 1000).toFixed(2)}s`
}

function formatRaceClock(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000))
  const m = String(Math.floor(safe / 60)).padStart(2, '0')
  const s = String(safe % 60).padStart(2, '0')
  return `${m}:${s}`
}

function applyRacerEvent(racer, text, ticks = 10) {
  racer.eventText = text
  racer.eventTicks = ticks
  racer.eventSeq = (racer.eventSeq || 0) + 1
}

function getMapLabel(mapId) {
  if (mapId === MAP_DIZZY_CLIFF) return '어질어질한 절벽'
  return '기본'
}

export default function App() {
  const [roomInput, setRoomInput] = useState('')
  const [roomId, setRoomId] = useState('')
  const [role, setRole] = useState('admin')
  const [activeView, setActiveView] = useState(VIEW_BOSS)
  const [bosses, setBosses] = useState({})
  const [editingKey, setEditingKey] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showManagePanel, setShowManagePanel] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [raceFilter, setRaceFilter] = useState(() => loadRaceFilterFromCookie())
  const [columnPrefs, setColumnPrefs] = useState(() => loadColumnPrefsFromCookie())
  const [columnOrder, setColumnOrder] = useState(() => loadColumnOrderFromCookie())
  const [columnWidths, setColumnWidths] = useState(() => loadColumnWidthsFromCookie())
  const [columnWidthsSeeded, setColumnWidthsSeeded] = useState(() => hasColumnWidthCookie())
  const [resizingColumn, setResizingColumn] = useState('')
  const [draggingColumn, setDraggingColumn] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [dragKey, setDragKey] = useState(null)
  const [isMapOpen, setIsMapOpen] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(() => loadTtsEnabledFromCookie())
  const [alertPrefs, setAlertPrefs] = useState(() => loadAlertPrefsFromCookie())
  const [ttsNoticeDialogOpen, setTtsNoticeDialogOpen] = useState(false)
  const [ttsNoticeDontShow, setTtsNoticeDontShow] = useState(() => {
    return window.localStorage.getItem(TTS_NOTICE_DISMISS_KEY) === 'true'
  })
  const [mapAspectRatio, setMapAspectRatio] = useState('16 / 9')
  const [roomDataLoaded, setRoomDataLoaded] = useState(false)
  const [adjacentBossThresholdSec, setAdjacentBossThresholdSec] = useState(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC)
  const [adjacentBossThresholdInput, setAdjacentBossThresholdInput] = useState(String(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC))
  const [timeDialog, setTimeDialog] = useState({
    open: false,
    key: '',
    name: '',
    h: 0,
    m: 0,
    s: 0
  })
  const [syncNoticeDialog, setSyncNoticeDialog] = useState({
    open: false,
    bosses: []
  })

  const mapViewportRef = useRef(null)
  const mapImgRef = useRef(null)
  const tableWrapRef = useRef(null)
  const mapRef = useRef({
    scale: 1,
    x: 0,
    y: 0,
    initialized: false,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0
  })
  const resizeRef = useRef({
    key: '',
    startX: 0,
    startWidth: 0
  })
  const ttsStateRef = useRef({
    cycleId: '',
    prevRemainingMs: null,
    armed: false
  })
  const syncNoticeShownRef = useRef(false)
  const syncNoticeCheckedOnEntryRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room) setRoomInput(room)
  }, [])

  useEffect(() => {
    saveTtsEnabledToCookie(ttsEnabled)
    if (!ttsEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [ttsEnabled])

  useEffect(() => {
    window.localStorage.setItem(TTS_NOTICE_DISMISS_KEY, ttsNoticeDontShow ? 'true' : 'false')
  }, [ttsNoticeDontShow])

  useEffect(() => {
    const offsetRef = ref(db, '.info/serverTimeOffset')
    const unsubscribe = onValue(offsetRef, (snapshot) => {
      const offset = Number(snapshot.val())
      setServerOffsetMs(Number.isFinite(offset) ? offset : 0)
    })
    return () => unsubscribe()
  }, [])

  const getServerNow = useCallback(() => Date.now() + serverOffsetMs, [serverOffsetMs])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getServerNow()), 1000)
    setNow(getServerNow())
    return () => window.clearInterval(timer)
  }, [getServerNow])

  useEffect(() => {
    if (!roomId) return undefined

    const roomRef = ref(db, `${roomId}/bosses`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      setBosses(snapshot.val() || {})
      setRoomDataLoaded(true)
    })

    return () => unsubscribe()
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const roomSettingsRef = ref(db, `${roomId}/settings`)
    const unsubscribe = onValue(roomSettingsRef, (snapshot) => {
      const sec = normalizeAdjacentBossThresholdSec(snapshot.val()?.adjacentBossThresholdSec)
      setAdjacentBossThresholdSec(sec)
      setAdjacentBossThresholdInput(String(sec))
    })

    return () => unsubscribe()
  }, [roomId])

  const bossList = useMemo(() => getBossList(bosses, now), [bosses, now])
  const enabledBossList = useMemo(() => {
    return bossList.filter((boss) => boss.alertEnabled !== false)
  }, [bossList])
  const filteredBossList = useMemo(() => {
    if (raceFilter === '모두') {
      return enabledBossList
    }
    return enabledBossList.filter((boss) => (boss.race || '마족') === raceFilter)
  }, [enabledBossList, raceFilter])
  const orderedBosses = useMemo(() => {
    return Object.entries(bosses)
      .sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0))
      .map(([key, value]) => ({ key, ...value, alertEnabled: value?.alertEnabled !== false }))
  }, [bosses])
  const filteredOrderedBosses = useMemo(() => {
    if (raceFilter === '모두') {
      return orderedBosses
    }
    return orderedBosses.filter((boss) => (boss.race || '마족') === raceFilter)
  }, [orderedBosses, raceFilter])

  const panelBosses = useMemo(() => {
    return filteredBossList.filter((boss) => Number.isFinite(boss.effectiveTime) && boss.effectiveTime < Number.MAX_SAFE_INTEGER)
  }, [filteredBossList])

  const mainBoss = panelBosses[0] ?? null
  const nextBoss = panelBosses.length > 1 ? panelBosses[1] : null
  const prevBoss = panelBosses.length > 1 ? panelBosses[panelBosses.length - 1] : null
  const adjacentSpawnBossGroups = useMemo(() => {
    const adjacentThresholdMs = adjacentBossThresholdSec * 1000
    const groups = []
    if (panelBosses.length < 2) return groups

    let currentGroup = [panelBosses[0]]

    for (let i = 0; i < panelBosses.length - 1; i += 1) {
      const current = panelBosses[i]
      const next = panelBosses[i + 1]
      if (!Number.isFinite(current.effectiveTime) || !Number.isFinite(next.effectiveTime)) continue
      if (Math.abs(next.effectiveTime - current.effectiveTime) <= adjacentThresholdMs) {
        if (currentGroup[currentGroup.length - 1]?.key !== next.key) {
          currentGroup.push(next)
        }
      } else {
        if (currentGroup.length >= 2) groups.push(currentGroup)
        currentGroup = [next]
      }
    }

    if (currentGroup.length >= 2) groups.push(currentGroup)
    return groups
  }, [panelBosses, adjacentBossThresholdSec])
  const nearSpawnBossKeySet = useMemo(() => {
    return new Set(adjacentSpawnBossGroups.flat().map((boss) => boss.key))
  }, [adjacentSpawnBossGroups])
  const adjacentSpawnGroupLines = useMemo(() => {
    return adjacentSpawnBossGroups.map((group) =>
      group
        .map((boss) => {
          const sec = Math.max(0, Math.floor((boss.effectiveTime - now) / 1000))
          return sec <= 600 ? `${boss.name}(${sec}s)` : boss.name
        })
        .join(' vs ')
    )
  }, [adjacentSpawnBossGroups, now])
  const highlightedRows = useMemo(() => {
    return {
      main: mainBoss?.key ?? '',
      next: nextBoss?.key ?? ''
    }
  }, [mainBoss, nextBoss])
  const syncNeededBosses = useMemo(() => {
    return orderedBosses
      .filter((boss) => boss.alertEnabled !== false)
      .filter((boss) => isSyncNeeded(boss, now))
      .map((boss) => ({ name: boss.name, color: boss.color || '#ffadad' }))
  }, [orderedBosses, now])
  const mapImageSrc = `${import.meta.env.BASE_URL}aion2boss.png`
  const shouldShowColumn = useCallback((key) => {
    if (showManagePanel) return true
    return columnPrefs[key]
  }, [showManagePanel, columnPrefs])
  const orderedVisibleColumnKeys = useMemo(() => {
    return columnOrder.filter((key) => shouldShowColumn(key))
  }, [columnOrder, shouldShowColumn])
  const tableTotalWidth = useMemo(() => {
    let sum = 0
    orderedVisibleColumnKeys.forEach((key) => {
      sum += columnWidths[key]
    })
    if (role === 'admin' && showManagePanel) sum += columnWidths.manage
    return sum
  }, [orderedVisibleColumnKeys, columnWidths, role, showManagePanel])

  useEffect(() => {
    saveColumnPrefsToCookie(columnPrefs)
  }, [columnPrefs])

  useEffect(() => {
    saveColumnWidthsToCookie(columnWidths)
  }, [columnWidths])

  useEffect(() => {
    saveColumnOrderToCookie(columnOrder)
  }, [columnOrder])

  useEffect(() => {
    saveRaceFilterToCookie(raceFilter)
  }, [raceFilter])

  useEffect(() => {
    saveAlertPrefsToCookie(alertPrefs)
  }, [alertPrefs])

  useEffect(() => {
    if (columnWidthsSeeded) return undefined
    if (!roomId) return undefined

    const raf = window.requestAnimationFrame(() => {
      const wrapWidth = tableWrapRef.current?.clientWidth || 0
      if (wrapWidth <= 0) return

      const visibleKeys = [...orderedVisibleColumnKeys]
      if (role === 'admin' && showManagePanel) visibleKeys.push('manage')
      if (!visibleKeys.length) return

      const eachWidth = Math.max(70, Math.floor(wrapWidth / visibleKeys.length))
      setColumnWidths((prev) => {
        const next = { ...prev }
        visibleKeys.forEach((key) => {
          next[key] = eachWidth
        })
        return next
      })
      setColumnWidthsSeeded(true)
    })

    return () => window.cancelAnimationFrame(raf)
  }, [columnWidthsSeeded, roomId, orderedVisibleColumnKeys, role, showManagePanel])

  useEffect(() => {
    if (!roomId || role !== 'admin') return
    if (!roomDataLoaded) return
    if (syncNoticeCheckedOnEntryRef.current) return

    syncNoticeCheckedOnEntryRef.current = true
    if (!syncNeededBosses.length || syncNoticeShownRef.current) return

    syncNoticeShownRef.current = true
    setSyncNoticeDialog({
      open: true,
      bosses: syncNeededBosses
    })
  }, [roomId, role, roomDataLoaded, syncNeededBosses])

  useEffect(() => {
    if (!ttsEnabled || !mainBoss || mainBoss.effectiveTime === Number.MAX_SAFE_INTEGER || mainBoss.alertEnabled === false) {
      ttsStateRef.current = { cycleId: '', prevRemainingMs: null, armed: false }
      return
    }

    const cycleId = `${mainBoss.key}:${mainBoss.effectiveTime}`
    const remainingMs = mainBoss.effectiveTime - now

    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      ttsStateRef.current = { cycleId, prevRemainingMs: remainingMs }
      return
    }

    const prevState = ttsStateRef.current
    if (prevState.cycleId !== cycleId || prevState.prevRemainingMs == null) {
      // Only arm TTS when the newly-tracked current boss still has enough lead time.
      // This prevents chained alerts from the immediately following boss (e.g. 14s case).
      ttsStateRef.current = { cycleId, prevRemainingMs: remainingMs, armed: remainingMs > ALERT_ARM_THRESHOLD_MS }
      return
    }

    if (!prevState.armed) {
      ttsStateRef.current = { ...prevState, prevRemainingMs: remainingMs }
      return
    }

    const hasOtherBossInWindow = (windowMs) => {
      return enabledBossList.some((boss) => {
        if (boss.key === mainBoss.key) return false
        if (!Number.isFinite(boss.effectiveTime) || boss.effectiveTime >= Number.MAX_SAFE_INTEGER) return false
        const bossRemainingMs = boss.effectiveTime - now
        return bossRemainingMs > 0 && bossRemainingMs <= windowMs
      })
    }

    for (const mark of ALERT_MARKS) {
      if (!alertPrefs[mark.id]) continue
      if (prevState.prevRemainingMs > mark.ms && remainingMs <= mark.ms) {
        if (hasOtherBossInWindow(mark.ms)) {
          continue
        }
        if ('speechSynthesis' in window) {
          const bossName = mainBoss.name || '보스'
          const utter = new SpeechSynthesisUtterance(`${bossName}, ${mark.notice}`)
          utter.lang = 'ko-KR'
          utter.rate = 1.2
          utter.pitch = 1.25
          utter.volume = 1
          window.speechSynthesis.speak(utter)
        }
      }
    }

    ttsStateRef.current = { ...prevState, prevRemainingMs: remainingMs }
  }, [ttsEnabled, mainBoss, now, alertPrefs, enabledBossList])

  const applyMapTransform = useCallback(() => {
    const img = mapImgRef.current
    if (!img) return
    const map = mapRef.current
    img.style.transform = `translate(${map.x}px, ${map.y}px) scale(${map.scale})`
  }, [])

  const constrainMap = useCallback(() => {
    const viewport = mapViewportRef.current
    const img = mapImgRef.current
    if (!viewport || !img || !img.naturalWidth || !img.naturalHeight) return

    const map = mapRef.current
    const currW = img.naturalWidth * map.scale
    const currH = img.naturalHeight * map.scale

    if (currW <= viewport.clientWidth) {
      map.x = (viewport.clientWidth - currW) / 2
    } else {
      map.x = Math.min(0, Math.max(viewport.clientWidth - currW, map.x))
    }

    if (currH <= viewport.clientHeight) {
      map.y = (viewport.clientHeight - currH) / 2
    } else {
      map.y = Math.min(0, Math.max(viewport.clientHeight - currH, map.y))
    }
  }, [])

  const centerMap = useCallback(() => {
    const viewport = mapViewportRef.current
    const img = mapImgRef.current
    if (!viewport || !img || !img.naturalWidth || !img.naturalHeight) return
    setMapAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`)

    const map = mapRef.current
    map.scale = 1
    map.x = (viewport.clientWidth - img.naturalWidth) / 2
    map.y = (viewport.clientHeight - img.naturalHeight) / 2
    map.initialized = true

    constrainMap()
    applyMapTransform()
  }, [applyMapTransform, constrainMap])

  const handleMapImageLoad = () => {
    const img = mapImgRef.current
    if (img?.naturalWidth && img?.naturalHeight) {
      setMapAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`)
    }
    centerMap()
  }

  useEffect(() => {
    if (!isMapOpen) return
    if (!mapRef.current.initialized) centerMap()
  }, [isMapOpen, centerMap])

  const flyTo = useCallback((mapX, mapY, retry = 0) => {
    if (!isMapOpen) {
      setIsMapOpen(true)
    }

    const viewport = mapViewportRef.current
    const img = mapImgRef.current
    if (!viewport || !img || !img.naturalWidth || !img.naturalHeight) {
      if (retry < 6) {
        window.requestAnimationFrame(() => flyTo(mapX, mapY, retry + 1))
      }
      return
    }

    const map = mapRef.current
    map.scale = CONFIG.MAP.FLY_SCALE
    map.x = viewport.clientWidth / 2 - Number(mapX) * img.naturalWidth * map.scale
    map.y = viewport.clientHeight / 2 - Number(mapY) * img.naturalHeight * map.scale

    img.classList.add('fly-animation')
    constrainMap()
    applyMapTransform()

    window.setTimeout(() => img.classList.remove('fly-animation'), CONFIG.MAP.FLY_DURATION_MS)
  }, [applyMapTransform, constrainMap, isMapOpen])

  const updateBoss = useCallback((key, payload) => {
    return update(ref(db, `${roomId}/bosses/${key}`), payload)
  }, [roomId])

  const removeBoss = useCallback((key) => {
    return remove(ref(db, `${roomId}/bosses/${key}`))
  }, [roomId])

  const saveOrder = useCallback((updates) => {
    return update(ref(db), updates)
  }, [])
  const updateRoomSettings = useCallback((payload) => {
    return update(ref(db, `${roomId}/settings`), payload)
  }, [roomId])

  const pushHistory = useCallback((key, data) => {
    setUndoStack((prev) => [...prev, { key, data: { ...data } }])
    setRedoStack([])
  }, [])

  const handleLogin = () => {
    const room = roomInput.trim()
    if (!room) {
      window.alert('방 이름을 입력해주세요.')
      return
    }

    setRoomId(room)
    setUndoStack([])
    setRedoStack([])
    setEditingKey(null)
    setShowForm(false)
    setShowManagePanel(false)
    setActiveView(VIEW_BOSS)
    setRoomDataLoaded(false)
    setAdjacentBossThresholdSec(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC)
    setAdjacentBossThresholdInput(String(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC))
    setSyncNoticeDialog({ open: false, bosses: [] })
    syncNoticeShownRef.current = false
    syncNoticeCheckedOnEntryRef.current = false

    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(room)}`
    window.history.pushState({ path: newUrl }, '', newUrl)
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      window.alert('주소가 복사되었습니다!')
    } catch {
      window.alert('주소 복사에 실패했습니다.')
    }
  }

  const handleLeave = () => {
    if (!window.confirm('정말 나가시겠습니까?')) return
    setActiveView(VIEW_BOSS)
    window.location.href = window.location.pathname
  }

  const openRacingView = () => {
    setShowForm(false)
    setTimeDialog({ open: false, key: '', name: '', h: 0, m: 0, s: 0 })
    setSyncNoticeDialog({ open: false, bosses: [] })
    setActiveView(VIEW_RACING)
  }

  const openBossView = () => {
    setActiveView(VIEW_BOSS)
  }

  const openRemainingDialog = (boss) => {
    if (role !== 'admin') return
    const spawn = getSpawnInfo(boss, now)
    const clock = diffToClock((spawn.time ?? now) - now)
    setTimeDialog({
      open: true,
      key: boss.key,
      name: boss.name || '',
      h: Math.min(clock.h, 24),
      m: clock.m,
      s: clock.s
    })
  }

  const closeRemainingDialog = () => {
    setTimeDialog({ open: false, key: '', name: '', h: 0, m: 0, s: 0 })
  }

  const saveRemainingTime = async () => {
    const boss = bosses[timeDialog.key]
    if (!boss) return closeRemainingDialog()
    if (!boss.interval) {
      window.alert('젠 주기가 없습니다.')
      return
    }

    const h = Math.max(0, Math.min(24, Number(timeDialog.h) || 0))
    const m = Math.max(0, Math.min(59, Number(timeDialog.m) || 0))
    const s = Math.max(0, Math.min(59, Number(timeDialog.s) || 0))
    const totalMs = (h * 3600 + m * 60 + s) * 1000

    const nextSpawnTimestamp = getServerNow() + totalMs
    const intervalMs = Number(boss.interval) * 3600000
    const lastKillTimestamp = nextSpawnTimestamp - intervalMs

    pushHistory(timeDialog.key, boss)
    await updateBoss(timeDialog.key, {
      lastKillTimestamp,
      nextSpawnTimestamp
    })
    closeRemainingDialog()
  }

  const submitRemainingTime = (e) => {
    e.preventDefault()
    saveRemainingTime()
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingKey(null)
  }

  const openCreateForm = () => {
    if (showForm && !editingKey) {
      setShowForm(false)
      resetForm()
      return
    }
    setShowForm(true)
    resetForm()
  }

  const setEditMode = (boss) => {
    if (editingKey === boss.key) {
      setShowForm(false)
      resetForm()
      return
    }

    setEditingKey(boss.key)
    setForm({
      name: boss.name ?? '',
      color: boss.color ?? '#ffadad',
      race: boss.race || '마족',
      location: boss.location ?? '',
      drop: boss.drop ?? '',
      interval: String(boss.interval ?? ''),
      mapX: boss.mapX ?? '',
      mapY: boss.mapY ?? ''
    })
    setShowForm(true)
  }

  const handleFormSubmit = async () => {
    const name = form.name.trim()
    const interval = form.interval

    if (!name) return window.alert('보스명을 입력해주세요.')
    if (name.length > CONFIG.LIMITS.NAME) return window.alert(`보스명은 ${CONFIG.LIMITS.NAME}자 이내여야 합니다.`)
    if (!interval) return window.alert('젠 주기를 선택해주세요.')
    if (form.location.length > CONFIG.LIMITS.LOC) return window.alert('위치 정보가 너무 깁니다.')
    if (form.drop.length > CONFIG.LIMITS.INFO) return window.alert('정보 내용이 너무 깁니다.')

    const payload = {
      name,
      color: form.color,
      race: form.race || '마족',
      location: form.location.trim(),
      drop: form.drop.trim(),
      interval,
      alertEnabled: editingKey ? bosses[editingKey]?.alertEnabled !== false : true,
      mapX: form.mapX,
      mapY: form.mapY
    }

    if (editingKey) {
      const oldData = bosses[editingKey]
      let { lastKillTimestamp, nextSpawnTimestamp } = oldData
      if (lastKillTimestamp && Number(interval) !== Number(oldData.interval)) {
        nextSpawnTimestamp = Number(lastKillTimestamp) + Number(interval) * 3600000
      }

      if (name !== editingKey) {
        await removeBoss(editingKey)
      }

      await updateBoss(name, {
        ...payload,
        lastKillTimestamp,
        nextSpawnTimestamp,
        order: oldData.order
      })
      window.alert('수정 완료')
    } else {
      await updateBoss(name, {
        ...payload,
        order: getServerNow()
      })
    }

    setShowForm(false)
    resetForm()
  }

  const toggleManagePanel = () => {
    setShowManagePanel((prev) => {
      const next = !prev
      if (!next) setDragKey(null)
      return next
    })
  }

  const handleToggleTts = () => {
    if (ttsEnabled) {
      setTtsEnabled(false)
      return
    }

    setTtsEnabled(true)
    if (!ttsNoticeDontShow) {
      setTtsNoticeDialogOpen(true)
    }
  }

  const closeTtsNoticeDialog = () => {
    setTtsNoticeDialogOpen(false)
  }

  const handleAdjacentThresholdInputChange = (event) => {
    const raw = event.target.value
    if (raw === '') {
      setAdjacentBossThresholdInput('')
      return
    }
    const digits = raw.replace(/[^\d]/g, '')
    if (!digits) {
      setAdjacentBossThresholdInput('')
      return
    }
    const sec = normalizeAdjacentBossThresholdSec(Number(digits))
    setAdjacentBossThresholdInput(String(sec))
  }

  const saveAdjacentThreshold = async () => {
    const sec = normalizeAdjacentBossThresholdSec(adjacentBossThresholdInput)
    setAdjacentBossThresholdSec(sec)
    setAdjacentBossThresholdInput(String(sec))
    if (role !== 'admin' || !roomId) return
    await updateRoomSettings({ adjacentBossThresholdSec: sec })
  }

  const handleAdjacentThresholdInputKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.currentTarget.blur()
  }

  const closeSyncNoticeDialog = () => {
    setSyncNoticeDialog({ open: false, bosses: [] })
  }

  const toggleColumnPref = (key) => {
    setColumnPrefs((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleAlertPref = (key) => {
    setAlertPrefs((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleBossAlertEnabled = async (boss) => {
    if (role !== 'admin') return
    await updateBoss(boss.key, { alertEnabled: boss.alertEnabled === false })
  }

  const handleColumnDragStart = (e, key) => {
    if (!(role === 'admin' && showManagePanel)) return
    if (resizingColumn) return
    setDraggingColumn(key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }

  const handleColumnDrop = (targetKey) => {
    if (!draggingColumn || draggingColumn === targetKey) {
      setDraggingColumn('')
      return
    }
    setColumnOrder((prev) => {
      const from = prev.indexOf(draggingColumn)
      const to = prev.indexOf(targetKey)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
    setDraggingColumn('')
  }

  const startColumnResize = (e, key) => {
    if (typeof e.button === 'number' && e.button !== 0) return
    const clientX = getPointerClientX(e)
    if (clientX == null) return
    e.preventDefault()
    resizeRef.current = {
      key,
      startX: clientX,
      startWidth: columnWidths[key] || DEFAULT_COLUMN_WIDTHS[key] || 120
    }
    setResizingColumn(key)
  }

  const closeBossFormDialog = () => {
    setShowForm(false)
    resetForm()
  }

  const handleDelete = async (key) => {
    if (!window.confirm(`정말로 [${key}] 보스를 삭제하시겠습니까?`)) return
    await removeBoss(key)
    if (editingKey === key) {
      setShowForm(false)
      resetForm()
    }
  }

  const handleSort = async () => {
    const nowTs = getServerNow()
    const sorted = Object.entries(bosses).sort((a, b) => {
      const aEnabled = a[1]?.alertEnabled !== false
      const bEnabled = b[1]?.alertEnabled !== false
      const aTime = aEnabled ? (getSpawnInfo(a[1], nowTs).time ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
      const bTime = bEnabled ? (getSpawnInfo(b[1], nowTs).time ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
      return aTime - bTime
    })

    const updates = {}
    sorted.forEach(([key], idx) => {
      updates[`${roomId}/bosses/${key}/order`] = idx
    })
    await saveOrder(updates)
  }

  const handleUndo = async () => {
    if (!undoStack.length) return

    const action = undoStack[undoStack.length - 1]
    const current = bosses[action.key]
    setUndoStack((prev) => prev.slice(0, -1))
    setRedoStack((prev) => [...prev, { key: action.key, data: { ...(current || {}) } }])

    await updateBoss(action.key, {
      lastKillTimestamp: action.data.lastKillTimestamp,
      nextSpawnTimestamp: action.data.nextSpawnTimestamp
    })
  }

  const handleRedo = async () => {
    if (!redoStack.length) return

    const action = redoStack[redoStack.length - 1]
    const current = bosses[action.key]
    setRedoStack((prev) => prev.slice(0, -1))
    setUndoStack((prev) => [...prev, { key: action.key, data: { ...(current || {}) } }])

    await updateBoss(action.key, {
      lastKillTimestamp: action.data.lastKillTimestamp,
      nextSpawnTimestamp: action.data.nextSpawnTimestamp
    })
  }

  const handleDragStart = (key) => setDragKey(key)

  const handleDrop = async (targetKey) => {
    if (!dragKey || dragKey === targetKey) return

    const keys = orderedBosses.map((boss) => boss.key)
    const from = keys.indexOf(dragKey)
    const to = keys.indexOf(targetKey)
    if (from === -1 || to === -1) return

    keys.splice(to, 0, keys.splice(from, 1)[0])

    const updates = {}
    keys.forEach((key, idx) => {
      updates[`${roomId}/bosses/${key}/order`] = idx
    })

    setDragKey(null)
    await saveOrder(updates)
  }

  const renderCountdown = (boss) => {
    if (!boss || boss.effectiveTime === Number.MAX_SAFE_INTEGER) return '--:--:--'
    const diff = Math.max(0, boss.effectiveTime - now)
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
  }

  const mainSyncNeeded = mainBoss ? isSyncNeeded(mainBoss, now) : false
  const prevSyncNeeded = prevBoss ? isSyncNeeded(prevBoss, now) : false
  const nextSyncNeeded = nextBoss ? isSyncNeeded(nextBoss, now) : false

  const handleMapWheel = (e) => {
    e.preventDefault()

    const viewport = mapViewportRef.current
    const img = mapImgRef.current
    if (!viewport || !img) return

    const map = mapRef.current
    const centerX = viewport.clientWidth / 2
    const centerY = viewport.clientHeight / 2

    const xs = (centerX - map.x) / map.scale
    const ys = (centerY - map.y) / map.scale

    map.scale = e.deltaY < 0 ? map.scale * 1.2 : map.scale / 1.2
    map.scale = Math.max(CONFIG.MAP.MIN_SCALE, Math.min(CONFIG.MAP.MAX_SCALE, map.scale))

    map.x = centerX - xs * map.scale
    map.y = centerY - ys * map.scale

    constrainMap()
    applyMapTransform()
  }

  const handleMapMouseDown = (e) => {
    const map = mapRef.current
    map.dragging = true
    map.dragStartX = e.clientX - map.x
    map.dragStartY = e.clientY - map.y
  }

  useEffect(() => {
    const move = (e) => {
      const map = mapRef.current
      if (!map.dragging) return

      map.x = e.clientX - map.dragStartX
      map.y = e.clientY - map.dragStartY
      constrainMap()
      applyMapTransform()
    }

    const up = () => {
      mapRef.current.dragging = false
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)

    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [applyMapTransform, constrainMap])

  useEffect(() => {
    const handleDialogKeydown = (e) => {
      if (activeView === VIEW_BOSS && timeDialog.open && e.key === 'Enter' && !e.repeat) {
        e.preventDefault()
        e.stopPropagation()
        saveRemainingTime()
        return
      }

      if (e.key !== 'Escape') return

      if (showForm) {
        closeBossFormDialog()
        return
      }
      if (timeDialog.open) {
        closeRemainingDialog()
        return
      }
      if (ttsNoticeDialogOpen) {
        closeTtsNoticeDialog()
        return
      }
      if (syncNoticeDialog.open) {
        closeSyncNoticeDialog()
      }
    }

    window.addEventListener('keydown', handleDialogKeydown)
    return () => window.removeEventListener('keydown', handleDialogKeydown)
  }, [
    activeView,
    saveRemainingTime,
    showForm,
    timeDialog.open,
    ttsNoticeDialogOpen,
    syncNoticeDialog.open
  ])

  useEffect(() => {
    if (!resizingColumn) return undefined

    const handleMove = (e) => {
      const { key, startX, startWidth } = resizeRef.current
      if (!key) return
      const clientX = getPointerClientX(e)
      if (clientX == null) return
      if (typeof e.preventDefault === 'function') e.preventDefault()
      const delta = clientX - startX
      const nextWidth = Math.max(70, Math.min(700, Math.round(startWidth + delta)))
      setColumnWidths((prev) => ({ ...prev, [key]: nextWidth }))
    }

    const handleUp = () => {
      setResizingColumn('')
      resizeRef.current = { key: '', startX: 0, startWidth: 0 }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleUp)
    window.addEventListener('touchcancel', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
      window.removeEventListener('touchcancel', handleUp)
    }
  }, [resizingColumn])

  return (
    <div className='page'>
      {!roomId ? (
        <section className='login-wrap'>
          <div className='login-card'>
            <h1>필드 보스 타이머</h1>
            <p>방 이름을 입력하고 역할을 선택하세요.</p>

            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder='예: 1서버마족, A공대'
              className='input-text large'
            />

            <div className='role-switch'>
              <label className={role === 'admin' ? 'active' : ''}>
                <input type='radio' checked={role === 'admin'} onChange={() => setRole('admin')} />
                관리자
              </label>
              <label className={role === 'guest' ? 'active' : ''}>
                <input type='radio' checked={role === 'guest'} onChange={() => setRole('guest')} />
                손님
              </label>
            </div>

            <button className='btn primary block' onClick={handleLogin}>입장하기</button>
          </div>
        </section>
      ) : (
        <main className={`app-shell ${activeView === VIEW_RACING ? 'app-shell-racing' : ''}`}>
          <header className='topbar'>
            <div className='room-pill'>ROOM: {roomId} / {role === 'admin' ? '관리자' : '손님'}</div>
            <div className='topbar-actions'>
              <button className='btn ghost' onClick={activeView === VIEW_BOSS ? openRacingView : openBossView}>
                {activeView === VIEW_BOSS ? TOPBAR_LABEL_TO_RACING : TOPBAR_LABEL_TO_BOSS}
              </button>
              <button className='btn ghost' onClick={handleShare}>주소복사</button>
              {role === 'admin' ? <button className='btn danger ghost' onClick={handleLeave}>방 나가기</button> : null}
            </div>
          </header>

          {activeView === VIEW_BOSS ? (
            <>
              <section className='hero card'>
            <div className='hero-label'>NEXT BOSS</div>
            <div className='boss-grid'>
              <BossCard
                title='PREV'
                boss={prevBoss}
                countdown={renderCountdown(prevBoss)}
                syncNeeded={prevSyncNeeded}
                onFly={() => hasMapPoint(prevBoss) && flyTo(prevBoss.mapX, prevBoss.mapY)}
              />

              <section className='boss-main'>
                <h2 className='boss-main-name'>
                  {mainBoss?.name ? `[${mainBoss.name}] 젠까지` : '대기 중...'}
                </h2>
                {mainSyncNeeded ? <p className='sync-help-text'>싱크를 맞춰주세요</p> : null}
                <div className={`boss-main-time ${mainSyncNeeded ? 'sync-needed-time' : ''} ${mainBoss && mainBoss.effectiveTime - now < CONFIG.UI.WARNING_MS ? 'warning' : ''}`}>
                  {renderCountdown(mainBoss)}
                </div>
                <div className='boss-main-actions'>
                  {mainBoss?.location ? (
                    <button
                      className={`btn ${hasMapPoint(mainBoss) ? 'primary' : 'muted'}`}
                      disabled={!hasMapPoint(mainBoss)}
                      onClick={() => hasMapPoint(mainBoss) && flyTo(mainBoss.mapX, mainBoss.mapY)}
                    >
                      📍 {mainBoss.location}
                    </button>
                  ) : null}
                </div>
                <p className='boss-main-drop'>{mainBoss?.drop ? `ℹ️ ${mainBoss.drop}` : ''}</p>
              </section>

              <BossCard
                title='NEXT'
                boss={nextBoss}
                countdown={renderCountdown(nextBoss)}
                syncNeeded={nextSyncNeeded}
                onFly={() => hasMapPoint(nextBoss) && flyTo(nextBoss.mapX, nextBoss.mapY)}
              />
            </div>

            <div className='map-wrap'>
              {adjacentSpawnGroupLines.length ? (
                <div className='adjacent-spawn-info'>
                  {adjacentSpawnGroupLines.map((line, idx) => (
                    <div key={`adjacent-line-${idx}`}>{line}</div>
                  ))}
                </div>
              ) : null}
              <button className='btn ghost' onClick={() => setIsMapOpen((v) => !v)}>
                {isMapOpen ? '지도 닫기' : '지도 열기'}
              </button>
              {isMapOpen ? (
                <div
                  className='map-viewport'
                  style={{ aspectRatio: mapAspectRatio }}
                  ref={mapViewportRef}
                  onWheel={handleMapWheel}
                  onMouseDown={handleMapMouseDown}
                >
                  <img ref={mapImgRef} src={mapImageSrc} alt='보스 지도' draggable='false' onLoad={handleMapImageLoad} />
                </div>
              ) : null}
            </div>
          </section>

          <section className='card status-card'>
            <div className='section-head'>
              <div className='section-left'>
                <h3>보스 현황</h3>
                <select className='input-text filter-select' value={raceFilter} onChange={(e) => setRaceFilter(e.target.value)}>
                  <option value='모두'>모두</option>
                  <option value='천족'>천족</option>
                  <option value='마족'>마족</option>
                  <option value='기타'>기타</option>
                </select>
              </div>
              {role === 'admin' ? (
                <div className='section-actions'>
                  <button
                    className={`btn ghost bell-btn ${ttsEnabled ? 'active' : ''}`}
                    onClick={handleToggleTts}
                    aria-label={ttsEnabled ? '음성 알림 끄기' : '음성 알림 켜기'}
                    title={ttsEnabled ? '음성 알림 켜짐' : '음성 알림 꺼짐'}
                  >
                    🔔
                  </button>
                  <button className='btn ghost' onClick={openCreateForm}>{showForm ? '폼 닫기' : '보스 추가'}</button>
                  <button className='btn ghost' onClick={toggleManagePanel}>{showManagePanel ? '수정 닫기' : '수정'}</button>
                </div>
              ) : null}
            </div>

            {role === 'admin' && showManagePanel ? (
              <div className='column-controls'>
                <section className='pref-group'>
                  <h4 className='pref-group-title'>개인 설정</h4>
                  <div className='pref-row'>
                    <span className='pref-row-label'>📋 정보 표시</span>
                    <div className='pref-row-options'>
                      <label><input type='checkbox' checked={columnPrefs.alert} onChange={() => toggleColumnPref('alert')} /> 알림</label>
                      <label><input type='checkbox' checked={columnPrefs.name} onChange={() => toggleColumnPref('name')} /> 보스명</label>
                      <label><input type='checkbox' checked={columnPrefs.info} onChange={() => toggleColumnPref('info')} /> 정보</label>
                      <label><input type='checkbox' checked={columnPrefs.location} onChange={() => toggleColumnPref('location')} /> 위치</label>
                      <label><input type='checkbox' checked={columnPrefs.remaining} onChange={() => toggleColumnPref('remaining')} /> 남은 시간</label>
                      <label><input type='checkbox' checked={columnPrefs.next} onChange={() => toggleColumnPref('next')} /> 다음 젠 시간</label>
                    </div>
                  </div>
                  <div className='pref-row alert-controls'>
                    <span className='pref-row-label'>🔔 알림 여부</span>
                    <div className='pref-row-options'>
                    {ALERT_MARKS.map((mark) => (
                      <label key={mark.id}><input type='checkbox' checked={alertPrefs[mark.id]} onChange={() => toggleAlertPref(mark.id)} /> {mark.label}</label>
                    ))}
                    </div>
                  </div>
                </section>
                <section className='pref-group'>
                  <h4 className='pref-group-title'>전체 설정</h4>
                  <div className='pref-row adjacent-threshold-controls'>
                    <span className='pref-row-label'>👉 중첩 탐지 (초)</span>
                    <div className='pref-row-options'>
                      <input
                        className='input-text adjacent-threshold-input'
                        type='number'
                        min={ADJACENT_BOSS_THRESHOLD_MIN_SEC}
                        max={ADJACENT_BOSS_THRESHOLD_MAX_SEC}
                        step='1'
                        value={adjacentBossThresholdInput}
                        onChange={handleAdjacentThresholdInputChange}
                        onBlur={saveAdjacentThreshold}
                        onKeyDown={handleAdjacentThresholdInputKeyDown}
                      />
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            <div className='boss-table-card'>
              <div className='table-wrap' ref={tableWrapRef}>
                <table className='boss-table' style={{ width: `${tableTotalWidth}px`, tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                    {orderedVisibleColumnKeys.map((key) => {
                      const canDragColumn = role === 'admin' && showManagePanel
                      return (
                      <th
                        key={key}
                        style={{ width: `${columnWidths[key]}px` }}
                        draggable={canDragColumn}
                        onDragStart={(e) => canDragColumn && handleColumnDragStart(e, key)}
                        onDragOver={(e) => canDragColumn && e.preventDefault()}
                        onDrop={() => canDragColumn && handleColumnDrop(key)}
                        onDragEnd={() => setDraggingColumn('')}
                        className={draggingColumn === key && canDragColumn ? 'dragging-col' : ''}
                      >
                        <div className='th-cell'>
                          {COLUMN_LABELS[key]}
                          <span
                            className='col-resizer'
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              startColumnResize(e, key)
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation()
                              startColumnResize(e, key)
                            }}
                          />
                        </div>
                      </th>
                      )
                    })}
                      {role === 'admin' && showManagePanel ? (
                        <th style={{ width: `${columnWidths.manage}px` }}>
                          <div className='th-cell'>
                            관리
                            <span
                              className='col-resizer'
                              onMouseDown={(e) => startColumnResize(e, 'manage')}
                              onTouchStart={(e) => startColumnResize(e, 'manage')}
                            />
                          </div>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                  {filteredOrderedBosses.map((boss) => {
                    const isTimerExcluded = boss.alertEnabled === false
                    const spawn = getSpawnInfo(boss, now)
                    const nextText = spawn.time ? formatDateTime(spawn.time) : '-'
                    const mapReady = hasMapPoint(boss)
                    const syncNeeded = !isTimerExcluded && isSyncNeeded(boss, now)

                    const rowClassName = [
                      dragKey === boss.key ? 'dragging' : '',
                      isTimerExcluded ? 'row-timer-disabled' : '',
                      highlightedRows.main === boss.key ? 'row-main-boss' : '',
                      highlightedRows.next === boss.key ? 'row-next-boss' : ''
                    ].filter(Boolean).join(' ')

                    const canReorder = role === 'admin' && showManagePanel

                    return (
                      <tr
                        key={boss.key}
                        draggable={canReorder}
                        onDragStart={() => canReorder && handleDragStart(boss.key)}
                        onDragOver={(e) => canReorder && e.preventDefault()}
                        onDrop={() => canReorder && handleDrop(boss.key)}
                        className={rowClassName}
                      >
                        {orderedVisibleColumnKeys.map((key) => {
                          if (key === 'alert') {
                            return (
                              <td key={key} className='alert-cell' style={{ width: `${columnWidths[key]}px` }}>
                                <input
                                  type='checkbox'
                                  className='boss-alert-checkbox'
                                  checked={boss.alertEnabled !== false}
                                  disabled={role !== 'admin'}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() => toggleBossAlertEnabled(boss)}
                                  aria-label={`${boss.name} 타이머 동작 사용`}
                                  title='체크 해제 시 타이머 기반 동작에서 제외'
                                />
                              </td>
                            )
                          }
                          if (key === 'name') {
                            return (
                              <td key={key} style={{ width: `${columnWidths[key]}px` }}>
                                <div className='name-cell'>
                                  {nearSpawnBossKeySet.has(boss.key) ? <span className='name-near-icon' title={`스폰 시간이 ${adjacentBossThresholdSec}초 이내로 인접한 보스`}>👉</span> : null}
                                  <span className='boss-name-text' style={{ color: boss.color || '#ffadad' }}>{boss.name}</span>
                                </div>
                              </td>
                            )
                          }
                          if (key === 'info') {
                            return (
                              <td key={key} style={{ width: `${columnWidths[key]}px` }}>
                                <span className='info-cell-text'>{boss.drop || '-'}</span>
                              </td>
                            )
                          }
                          if (key === 'location') {
                            return (
                              <td key={key} style={{ width: `${columnWidths[key]}px` }} className='location-cell'>
                                <span className='location-text'>{boss.location || '-'}</span>
                                {mapReady ? (
                                  <button
                                    className='btn tiny ghost map-icon-btn'
                                    onClick={() => flyTo(boss.mapX, boss.mapY)}
                                    aria-label={`${boss.name} 지도 보기`}
                                    title='지도 보기'
                                  >
                                    🗺️
                                  </button>
                                ) : null}
                              </td>
                            )
                          }
                          if (key === 'remaining') {
                            return (
                              <td key={key} style={{ width: `${columnWidths[key]}px` }}>
                                <button
                                  className={`btn tiny ghost time-cell-btn ${syncNeeded ? 'sync-needed' : ''}`}
                                  disabled={role !== 'admin' || isTimerExcluded}
                                  onClick={() => !isTimerExcluded && openRemainingDialog(boss)}
                                  title={isTimerExcluded ? '타이머 제외 상태입니다.' : (syncNeeded ? '싱크 필요: 남은 시간을 눌러 수정하세요.' : undefined)}
                                >
                                  {syncNeeded ? '! ' : ''}
                                  {renderCountdown({
                                    ...boss,
                                    effectiveTime: spawn.time ?? Number.MAX_SAFE_INTEGER
                                  })}
                                </button>
                              </td>
                            )
                          }
                          if (key === 'next') {
                            return (
                              <td key={key} style={{ width: `${columnWidths[key]}px` }}>
                                <span className='next-time-text'>{nextText}</span>
                              </td>
                            )
                          }
                          return null
                        })}
                        {role === 'admin' && showManagePanel ? (
                          <td style={{ width: `${columnWidths.manage}px` }}>
                            <div className='inline-actions'>
                              <button className='btn tiny' onClick={() => setEditMode(boss)}>수정</button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

              {role === 'admin' ? (
                <section className='card controls'>
                  <button className='btn' onClick={handleSort}>다음 젠 시간순 정렬</button>
                  <button className='btn' disabled={!undoStack.length} onClick={handleUndo}>실행 취소</button>
                  <button className='btn' disabled={!redoStack.length} onClick={handleRedo}>다시 실행</button>
                  <span className='creator-credit'>제작자: 마족 브리트라, 마도성 뿌띠</span>
                </section>
              ) : null}
            </>
          ) : (
            <RacingGamePage />
          )}
        </main>
      )}
      {activeView === VIEW_BOSS && timeDialog.open ? (
        <div className='dialog-backdrop' onClick={closeRemainingDialog}>
          <div className='dialog' onClick={(e) => e.stopPropagation()}>
            <h4>남은 시간 수정</h4>
            <p>시/분/초를 입력하면 [{timeDialog.name || '보스'}]의 다음 젠까지 남은 시간을 바로 반영합니다.</p>
            <form onSubmit={submitRemainingTime}>
              <div className='time-grid'>
                <label>
                  시
                  <input
                    type='number'
                    min='0'
                    max='24'
                    value={timeDialog.h}
                    onChange={(e) => setTimeDialog((prev) => ({ ...prev, h: e.target.value }))}
                  />
                </label>
                <label>
                  분
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={timeDialog.m}
                    onChange={(e) => setTimeDialog((prev) => ({ ...prev, m: e.target.value }))}
                  />
                </label>
                <label>
                  초
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={timeDialog.s}
                    onChange={(e) => setTimeDialog((prev) => ({ ...prev, s: e.target.value }))}
                  />
                </label>
              </div>
              <div className='dialog-actions'>
                <button type='button' className='btn ghost' onClick={closeRemainingDialog}>취소</button>
                <button type='submit' className='btn primary'>적용</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {activeView === VIEW_BOSS && ttsNoticeDialogOpen ? (
        <div className='dialog-backdrop' onClick={closeTtsNoticeDialog}>
          <div className='dialog tts-notice-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>음성 알림 안내</h4>
            <p>PC에서는 브라우저 특성상 음성이 간헐적으로 나오지 않을 수 있습니다. 모바일에서 접속을 추천드려요.</p>
            <label className='dialog-check'>
              <input type='checkbox' checked={ttsNoticeDontShow} onChange={(e) => setTtsNoticeDontShow(e.target.checked)} />
              다시 알리지 않음
            </label>
            <div className='dialog-actions'>
              <button className='btn primary' onClick={closeTtsNoticeDialog}>확인</button>
            </div>
          </div>
        </div>
      ) : null}
      {activeView === VIEW_BOSS && role === 'admin' && showForm ? (
        <div className='dialog-backdrop' onClick={closeBossFormDialog}>
          <div className='dialog form-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>{editingKey ? '보스 수정' : '보스 추가'}</h4>
            <div className='form-grid'>
              <input type='color' value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
              <input className='input-text' placeholder='보스명' value={form.name} maxLength={20} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <select className='input-text' value={form.race} onChange={(e) => setForm((p) => ({ ...p, race: e.target.value }))}>
                <option value='천족'>천족</option>
                <option value='마족'>마족</option>
                <option value='기타'>기타</option>
              </select>
              <input className='input-text' placeholder='위치 정보' value={form.location} maxLength={100} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
              <select className='input-text' value={form.interval} onChange={(e) => setForm((p) => ({ ...p, interval: e.target.value }))}>
                <option value=''>젠 주기</option>
                {Array.from({ length: 24 }, (_, idx) => idx + 1).map((n) => (
                  <option key={n} value={n}>{n}시간</option>
                ))}
              </select>
              <input className='input-text' placeholder='지도 X (0.0~1.0)' type='number' min='0' max='1' step='0.01' value={form.mapX} onChange={(e) => setForm((p) => ({ ...p, mapX: e.target.value }))} />
              <input className='input-text' placeholder='지도 Y (0.0~1.0)' type='number' min='0' max='1' step='0.01' value={form.mapY} onChange={(e) => setForm((p) => ({ ...p, mapY: e.target.value }))} />
              <textarea
                className='input-text textarea span-2'
                placeholder='정보 내용 (여러 줄 입력 가능)'
                value={form.drop}
                maxLength={400}
                rows={4}
                onChange={(e) => setForm((p) => ({ ...p, drop: e.target.value }))}
              />
              <div className='row-actions'>
                <button className='btn ghost' onClick={closeBossFormDialog}>취소</button>
                <button className='btn primary' onClick={handleFormSubmit}>{editingKey ? '수정 저장' : '등록'}</button>
                {editingKey ? <button className='btn danger' onClick={() => handleDelete(editingKey)}>삭제</button> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {activeView === VIEW_BOSS && syncNoticeDialog.open ? (
        <div className='dialog-backdrop' onClick={closeSyncNoticeDialog}>
          <div className='dialog' onClick={(e) => e.stopPropagation()}>
            <h4>싱크 필요 안내</h4>
            <p>
              보스{' '}
              {syncNoticeDialog.bosses.map((boss, idx) => (
                <span key={`${boss.name}-${idx}`}>
                  <span style={{ color: boss.color, fontWeight: 700 }}>{boss.name}</span>
                  {idx < syncNoticeDialog.bosses.length - 1 ? ', ' : ''}
                </span>
              ))}
              {' '}의 싱크가 필요합니다. 인게임 지도를 열어 탐험-&gt;네임드에서 남은 시간을 확인해서 수정해주세요.
            </p>
            <div className='dialog-actions'>
              <button className='btn primary' onClick={closeSyncNoticeDialog}>확인</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RacingGamePage() {
  const [petNamesInput, setPetNamesInput] = useState('')
  const [trackLengthInput, setTrackLengthInput] = useState(String(DEFAULT_RACE_DISTANCE))
  const [selectedMap, setSelectedMap] = useState(MAP_DEFAULT)
  const [racers, setRacers] = useState(() => createInitialRacers([]))
  const [isRunning, setIsRunning] = useState(false)
  const [rankingIds, setRankingIds] = useState([])
  const [projectiles, setProjectiles] = useState([])
  const [mapHazards, setMapHazards] = useState([])
  const [skillLogs, setSkillLogs] = useState([])
  const [resultPopup, setResultPopup] = useState({ open: false, entries: [] })
  const [skillInfoPopupOpen, setSkillInfoPopupOpen] = useState(false)
  const [isTopPanelsCollapsed, setIsTopPanelsCollapsed] = useState(false)
  const [bgmEnabled, setBgmEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(RACING_BGM_STORAGE_KEY) !== 'false'
  })
  const [sfxEnabled, setSfxEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(RACING_SFX_STORAGE_KEY) !== 'false'
  })
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(RACING_AUTO_SCROLL_STORAGE_KEY) !== 'false'
  })
  const [skillChancePercent, setSkillChancePercent] = useState(() => ({ ...DEFAULT_SKILL_CHANCE_PERCENT }))
  const [skillTickRangeSec, setSkillTickRangeSec] = useState(() => ({
    min: DEFAULT_SKILL_TICK_MIN_SEC,
    max: DEFAULT_SKILL_TICK_MAX_SEC
  }))

  const trackScrollRef = useRef(null)
  const autoScrollTargetRef = useRef(0)
  const autoScrollFrameRef = useRef(0)
  const trackWrapRef = useRef(null)
  const trackRefs = useRef({})
  const skillLogRef = useRef(null)
  const waitingBgmRef = useRef(null)
  const playingBgmRef = useRef(null)
  const bgmFadeRef = useRef({ frameId: 0, token: 0 })
  const bgmInitializedRef = useRef(false)
  const restartPlayingBgmRef = useRef(false)
  const throwingSfxRef = useRef(null)
  const boostSfxRef = useRef(null)
  const stunSfxRef = useRef(null)
  const shieldBreakSfxRef = useRef(null)
  const racersRef = useRef([])
  const projectilesRef = useRef([])
  const mapHazardsRef = useRef([])
  const startTimeRef = useRef(0)
  const lastTickAtRef = useRef(0)
  const finishOrderRef = useRef([])
  const nextMapEventAtRef = useRef(0)
  const logSeqRef = useRef(1)
  const hazardSeqRef = useRef(1)
  const projectileSeqRef = useRef(1)
  const projectileTimerRef = useRef([])
  const hitTimerRef = useRef([])
  const parsedPetNames = useMemo(() => parsePetNamesInput(petNamesInput), [petNamesInput])
  const effectiveSkillChance = useMemo(() => ({
    attack: Math.max(0, Math.min(1, Number(skillChancePercent.attack) / 100)),
    shield: Math.max(0, Math.min(1, Number(skillChancePercent.shield) / 100)),
    boost: Math.max(0, Math.min(1, Number(skillChancePercent.boost) / 100)),
    boulder: Math.max(0, Math.min(1, Number(skillChancePercent.boulder) / 100)),
    mud: Math.max(0, Math.min(1, Number(skillChancePercent.mud) / 100))
  }), [skillChancePercent])
  const effectiveSkillTickRange = useMemo(() => {
    const rawMin = Number(skillTickRangeSec.min)
    const rawMax = Number(skillTickRangeSec.max)
    const clampedMin = Number.isFinite(rawMin)
      ? Math.max(MIN_SKILL_TICK_SEC, Math.min(MAX_SKILL_TICK_SEC, rawMin))
      : DEFAULT_SKILL_TICK_MIN_SEC
    const clampedMax = Number.isFinite(rawMax)
      ? Math.max(MIN_SKILL_TICK_SEC, Math.min(MAX_SKILL_TICK_SEC, rawMax))
      : DEFAULT_SKILL_TICK_MAX_SEC
    const minSec = Math.min(clampedMin, clampedMax)
    const maxSec = Math.max(clampedMin, clampedMax)
    return {
      minSec,
      maxSec,
      minMs: minSec * 1000,
      maxMs: maxSec * 1000
    }
  }, [skillTickRangeSec.max, skillTickRangeSec.min])
  const raceDistance = useMemo(() => {
    const parsed = Number(trackLengthInput.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RACE_DISTANCE
    return Math.round(parsed)
  }, [trackLengthInput])
  const trackWorldWidth = useMemo(() => {
    const scaled = raceDistance * TRACK_WORLD_PX_PER_DISTANCE
    return Math.round(
      Math.max(MIN_TRACK_WORLD_WIDTH_PX, Math.min(MAX_TRACK_WORLD_WIDTH_PX, scaled))
    )
  }, [raceDistance])
  const racingCardBackgroundStyle = useMemo(() => {
    const isCliffMap = selectedMap === MAP_DIZZY_CLIFF
    const backgroundImage = isCliffMap ? racingDizzyCliffBackgroundImage : racingBackgroundImage
    const lanePatternImage = isCliffMap ? racingTrackPatternCliff : racingTrackPatternMeadow
    const laneSceneryStripImage = isCliffMap ? racingLaneSceneryCliff : racingLaneSceneryMeadow
    return {
      '--racing-bg-image': `url(${backgroundImage})`,
      '--racing-bg-overlay-top': isCliffMap ? 'rgba(18, 20, 22, 0.2)' : 'rgba(16, 28, 24, 0.14)',
      '--racing-bg-overlay-bottom': isCliffMap ? 'rgba(14, 16, 20, 0.3)' : 'rgba(12, 24, 21, 0.24)',
      '--track-shell-top': isCliffMap ? 'rgba(31, 25, 21, 0.58)' : 'rgba(21, 34, 26, 0.56)',
      '--track-shell-bottom': isCliffMap ? 'rgba(20, 16, 14, 0.62)' : 'rgba(15, 27, 20, 0.6)',
      '--track-border-color': isCliffMap ? 'rgba(122, 106, 89, 0.52)' : 'rgba(110, 150, 118, 0.48)',
      '--lane-border-color': isCliffMap ? 'rgba(126, 108, 90, 0.5)' : 'rgba(108, 145, 114, 0.46)',
      '--lane-base-top': isCliffMap ? 'rgba(58, 44, 34, 0.28)' : 'rgba(35, 63, 40, 0.26)',
      '--lane-base-bottom': isCliffMap ? 'rgba(44, 33, 26, 0.36)' : 'rgba(26, 50, 31, 0.34)',
      '--lane-scene-overlay-top': isCliffMap ? 'rgba(30, 24, 20, 0.08)' : 'rgba(20, 38, 27, 0.05)',
      '--lane-scene-overlay-bottom': isCliffMap ? 'rgba(23, 18, 15, 0.16)' : 'rgba(16, 31, 22, 0.11)',
      '--lane-center-line-color': isCliffMap ? 'rgba(176, 150, 124, 0.28)' : 'rgba(176, 215, 180, 0.26)',
      '--lane-inner-line-color': isCliffMap ? 'rgba(169, 145, 120, 0.2)' : 'rgba(166, 206, 164, 0.19)',
      '--lane-index-color': isCliffMap ? '#cab69f' : '#bedcb5',
      '--lane-scenery-opacity': isCliffMap ? 0.62 : 0.58,
      '--lane-scenery-strip-image': `url(${laneSceneryStripImage})`,
      '--lane-scenery-strip-opacity': isCliffMap ? 0.34 : 0.3,
      '--lane-track-pattern-image': `url(${lanePatternImage})`
    }
  }, [selectedMap])

  const shufflePetNamesInput = useCallback(() => {
    if (isRunning) return
    const names = parsePetNamesInput(petNamesInput)
    if (names.length < 2) return

    const shuffled = [...names]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    setPetNamesInput(shuffled.join(', '))
  }, [isRunning, petNamesInput])

  const raceCompleted = rankingIds.length > 0 && rankingIds.length === racers.length

  useEffect(() => {
    racersRef.current = racers
  }, [racers])

  useEffect(() => {
    projectilesRef.current = projectiles
  }, [projectiles])

  useEffect(() => {
    mapHazardsRef.current = mapHazards
  }, [mapHazards])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(RACING_BGM_STORAGE_KEY, bgmEnabled ? 'true' : 'false')
  }, [bgmEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(RACING_SFX_STORAGE_KEY, sfxEnabled ? 'true' : 'false')
  }, [sfxEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(RACING_AUTO_SCROLL_STORAGE_KEY, autoScrollEnabled ? 'true' : 'false')
  }, [autoScrollEnabled])

  const clearProjectileTimers = useCallback(() => {
    projectileTimerRef.current.forEach((timerId) => window.clearTimeout(timerId))
    hitTimerRef.current.forEach((timerId) => window.clearTimeout(timerId))
    projectileTimerRef.current = []
    hitTimerRef.current = []
  }, [])

  const stopTrackAutoScrollLoop = useCallback(() => {
    const frameId = autoScrollFrameRef.current
    if (frameId) {
      window.cancelAnimationFrame(frameId)
      autoScrollFrameRef.current = 0
    }
  }, [])

  const playSfx = useCallback((audioRef, volume = 0.9) => {
    if (!sfxEnabled) return
    const baseAudio = audioRef.current
    if (!baseAudio) return
    try {
      const clip = baseAudio.cloneNode(true)
      clip.volume = Math.max(0, Math.min(1, volume * RACING_SFX_VOLUME_SCALE))
      const playPromise = clip.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {})
      }
    } catch {
      // Ignore audio playback failures (for autoplay restrictions, etc.).
    }
  }, [sfxEnabled])

  const cancelBgmFade = useCallback(() => {
    const frameId = bgmFadeRef.current.frameId
    if (frameId) {
      window.cancelAnimationFrame(frameId)
      bgmFadeRef.current.frameId = 0
    }
  }, [])

  const safePlayAudio = useCallback((audio) => {
    if (!audio) return
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {})
    }
  }, [])

  const runBgmFade = useCallback(
    (primaryAudio, secondaryAudio, primaryTargetVolume, secondaryTargetVolume, options = {}) => {
      const { pausePrimaryOnEnd = false, pauseSecondaryOnEnd = false } = options

      cancelBgmFade()

      const transitionToken = bgmFadeRef.current.token + 1
      bgmFadeRef.current.token = transitionToken

      const startTime = performance.now()
      const startPrimaryVolume = Math.max(0, Math.min(1, Number(primaryAudio?.volume) || 0))
      const startSecondaryVolume = Math.max(0, Math.min(1, Number(secondaryAudio?.volume) || 0))
      const targetPrimaryVolume = Math.max(0, Math.min(1, primaryTargetVolume))
      const targetSecondaryVolume = Math.max(0, Math.min(1, secondaryTargetVolume))

      const step = (now) => {
        if (bgmFadeRef.current.token !== transitionToken) return

        const progress = Math.min(1, (now - startTime) / RACING_BGM_FADE_MS)
        const eased = progress * progress * (3 - 2 * progress)

        if (primaryAudio) {
          primaryAudio.volume = startPrimaryVolume + (targetPrimaryVolume - startPrimaryVolume) * eased
        }
        if (secondaryAudio) {
          secondaryAudio.volume = startSecondaryVolume + (targetSecondaryVolume - startSecondaryVolume) * eased
        }

        if (progress < 1) {
          bgmFadeRef.current.frameId = window.requestAnimationFrame(step)
          return
        }

        bgmFadeRef.current.frameId = 0
        if (pausePrimaryOnEnd && primaryAudio) {
          primaryAudio.pause()
        }
        if (pauseSecondaryOnEnd && secondaryAudio) {
          secondaryAudio.pause()
        }
      }

      bgmFadeRef.current.frameId = window.requestAnimationFrame(step)
    },
    [cancelBgmFade]
  )

  const syncRacingBgm = useCallback(() => {
    const waitingAudio = waitingBgmRef.current
    const playingAudio = playingBgmRef.current
    if (!waitingAudio || !playingAudio) return

    waitingAudio.loop = true
    playingAudio.loop = true
    if (!bgmInitializedRef.current) {
      waitingAudio.volume = 0
      playingAudio.volume = 0
      bgmInitializedRef.current = true
    }

    if (!bgmEnabled) {
      runBgmFade(waitingAudio, playingAudio, 0, 0, {
        pausePrimaryOnEnd: true,
        pauseSecondaryOnEnd: true
      })
      return
    }

    const activeAudio = isRunning ? playingAudio : waitingAudio
    const inactiveAudio = isRunning ? waitingAudio : playingAudio

    if (isRunning && restartPlayingBgmRef.current) {
      activeAudio.currentTime = 0
      restartPlayingBgmRef.current = false
    }

    safePlayAudio(activeAudio)
    if (!inactiveAudio.paused || inactiveAudio.volume > 0.001) {
      safePlayAudio(inactiveAudio)
    }

    runBgmFade(activeAudio, inactiveAudio, RACING_BGM_BASE_VOLUME, 0, {
      pauseSecondaryOnEnd: true
    })
  }, [bgmEnabled, isRunning, runBgmFade, safePlayAudio])

  const toggleRacingBgm = useCallback(() => {
    setBgmEnabled((prev) => !prev)
  }, [])

  const toggleRacingSfx = useCallback(() => {
    setSfxEnabled((prev) => !prev)
  }, [])

  const updateSkillChancePercent = useCallback((key, rawValue) => {
    const parsed = Number(rawValue)
    const nextValue = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
    setSkillChancePercent((prev) => ({
      ...prev,
      [key]: nextValue
    }))
  }, [])

  const updateSkillTickRangeSec = useCallback((key, rawValue) => {
    const parsed = Number(rawValue)
    const nextValue = Number.isFinite(parsed)
      ? Math.max(MIN_SKILL_TICK_SEC, Math.min(MAX_SKILL_TICK_SEC, parsed))
      : MIN_SKILL_TICK_SEC
    setSkillTickRangeSec((prev) => {
      const next = { ...prev, [key]: nextValue }
      if (next.min > next.max) {
        if (key === 'min') next.max = next.min
        else next.min = next.max
      }
      return next
    })
  }, [])

  const getRandomSkillTickMs = useCallback(() => {
    const { minMs, maxMs } = effectiveSkillTickRange
    if (maxMs <= minMs) return minMs
    return minMs + Math.random() * (maxMs - minMs)
  }, [effectiveSkillTickRange])

  const closeResultPopup = useCallback(() => {
    setResultPopup((prev) => ({ ...prev, open: false }))
  }, [])

  const openSkillInfoPopup = useCallback(() => {
    setSkillInfoPopupOpen(true)
  }, [])

  const closeSkillInfoPopup = useCallback(() => {
    setSkillInfoPopupOpen(false)
  }, [])

  useEffect(() => {
    if (isRunning) return
    clearProjectileTimers()
    setProjectiles([])
    projectilesRef.current = []
    mapHazardsRef.current = []
    setMapHazards([])
    nextMapEventAtRef.current = 0
    lastTickAtRef.current = 0
    setRankingIds([])
    setSkillLogs([])
    setResultPopup({ open: false, entries: [] })
    const nextRacers = createInitialRacers(parsedPetNames, racersRef.current)
    racersRef.current = nextRacers
    setRacers(nextRacers)
  }, [clearProjectileTimers, parsedPetNames, selectedMap])

  const raceLeader = useMemo(() => {
    if (!racers.length) return null
    return [...racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      if (a.finished && b.finished) return (a.finishTime ?? Number.MAX_SAFE_INTEGER) - (b.finishTime ?? Number.MAX_SAFE_INTEGER)
      return b.position - a.position
    })[0]
  }, [racers])

  const rankingEntries = useMemo(() => {
    if (!rankingIds.length) return []
    const byId = new Map(racers.map((racer) => [racer.id, racer]))
    return rankingIds.map((id) => byId.get(id)).filter(Boolean)
  }, [rankingIds, racers])

  const racerRows = useMemo(() => {
    const nowTick = typeof window !== 'undefined' && window.performance?.now
      ? window.performance.now()
      : Date.now()
    return racers.map((racer, idx) => {
      const progressRaw = raceDistance > 0 ? (racer.position / raceDistance) * 100 : 0
      const progress = Math.max(0, Math.min(100, progressRaw))
      const visualProgress = Math.max(RUNNER_MIN_PROGRESS_PERCENT, progress)
      const isStunned = racer.stunUntil > nowTick && !racer.finished
      const isBoosted = racer.boostUntil > nowTick && !racer.finished
      const isRunningState = racer.runUntil > nowTick && !racer.finished
      const cooldownDurationMs = Math.max(1, Number(racer.skillCooldownDurationMs) || 1)
      const cooldownRemainingMs = isRunning && !racer.finished
        ? racer.cooldownPaused
          ? Math.max(0, Number(racer.cooldownPauseRemainingMs) || cooldownDurationMs)
          : Math.max(0, (Number(racer.nextSkillRollAt) || 0) - nowTick)
        : 0
      const cooldownElapsedMs = racer.cooldownPaused
        ? 0
        : Math.max(0, cooldownDurationMs - cooldownRemainingMs)
      const cooldownProgress = Math.max(0, Math.min(1, cooldownElapsedMs / cooldownDurationMs))
      const eventClass =
        racer.eventText === '공격'
          ? 'is-attack'
          : racer.eventText === '실드' || racer.eventText === '방어'
            ? 'is-shield'
            : racer.eventText === '부스트'
              ? 'is-boost'
              : racer.eventText === '달려!'
                ? 'is-run'
              : racer.eventText === '기절'
                ? 'is-stun'
                : racer.eventText === '완주' || /\d+등$/.test(racer.eventText)
                  ? 'is-finished'
                  : racer.eventText === '감속'
                    ? 'is-slow'
                    : racer.eventText === '회피!'
                      ? 'is-evade'
                    : ''

      return {
        idx,
        racer,
        progress,
        isStunned,
        isBoosted,
        isRunningState,
        cooldownProgressPercent: cooldownProgress * 100,
        cooldownText: isRunning && !racer.finished ? `${(cooldownRemainingMs / 1000).toFixed(1)}s` : '',
        eventClass,
        runnerLeft: `clamp(${RUNNER_EDGE_PADDING_PX}px, ${visualProgress}%, calc(100% - ${RUNNER_EDGE_PADDING_PX}px))`
      }
    })
  }, [isRunning, racers, raceDistance])

  const appendSkillLogs = useCallback((messages, now) => {
    if (!messages.length) return
    const raceClock = formatRaceClock(now - startTimeRef.current)
    setSkillLogs((prev) => {
      const nextLogs = messages.map((message) => ({
        id: logSeqRef.current++,
        time: raceClock,
        message
      }))
      return [...prev, ...nextLogs].slice(-220)
    })
  }, [])

  const getTrackPointFromProgress = useCallback((racerId, progressPercent) => {
    const trackWrap = trackWrapRef.current
    const trackLane = trackRefs.current[racerId]
    if (!trackWrap || !trackLane) return null

    const wrapRect = trackWrap.getBoundingClientRect()
    const laneRect = trackLane.getBoundingClientRect()
    const safeProgress = Math.max(0, Math.min(100, progressPercent))
    const visualProgress = Math.max(RUNNER_MIN_PROGRESS_PERCENT, safeProgress)
    const laneWidth = Math.max(1, laneRect.width)
    const minX = Math.min(RUNNER_EDGE_PADDING_PX, laneWidth / 2)
    const maxX = Math.max(minX, laneWidth - minX)
    const runnerRange = Math.max(1, maxX - minX)
    const runnerX = minX + (visualProgress / 100) * runnerRange
    const x = laneRect.left - wrapRect.left + Math.max(minX, Math.min(maxX, runnerX))
    const y = laneRect.top - wrapRect.top + laneRect.height / 2

    return { x, y }
  }, [])

  const resolveProjectileImpact = useCallback((projectile, mutableRacers, now, pendingLogs) => {
    const target = mutableRacers.find((racer) => racer.id === projectile.toId)
    const attacker = mutableRacers.find((racer) => racer.id === projectile.fromId)
    const attackerName = attacker?.name || projectile.attackerName

    if (!target || target.finished) {
      pendingLogs.push(`${attackerName}의 당근이 빗나갔습니다.`)
      return
    }

    const boosted = target.boostUntil > now
    const boostedEvaded = boosted && Math.random() < 0.5
    const shieldActive = target.shieldUntil > now && target.shieldCharges > 0

    if (boostedEvaded) {
      if (shieldActive) {
        target.shieldCharges = 0
        target.shieldUntil = now
        target.isShieldActive = false
        playSfx(shieldBreakSfxRef, 0.72)
        pendingLogs.push(`${attackerName}의 당근을 ${target.name}이(가) 회피했습니다. 실드는 소모되었습니다.`)
      } else {
        pendingLogs.push(`${attackerName}의 당근을 ${target.name}이(가) 회피했습니다.`)
      }
      applyRacerEvent(target, '회피!', 12)
      return
    }

    if (shieldActive) {
      target.shieldCharges = 0
      target.shieldUntil = now
      target.isShieldActive = false
      applyRacerEvent(target, '방어', 10)
      playSfx(shieldBreakSfxRef, 0.72)
      pendingLogs.push(`${attackerName}의 당근이 ${target.name}에게 도착! 실드가 공격을 막았습니다.`)
      return
    }

    target.stunUntil = now + STUN_DURATION_MS
    applyRacerEvent(target, '기절', 10)
    target.status = '기절'
    playSfx(stunSfxRef, 0.8)
    pendingLogs.push(`${attackerName}의 당근이 ${target.name}에게 적중! 2초 동안 기절합니다.`)
  }, [playSfx])

  const updateProjectiles = useCallback((shotsPrev, mutableRacers, now, elapsedMs, pendingLogs) => {
    if (!shotsPrev.length) return shotsPrev

    const nextShots = []

    shotsPrev.forEach((shot) => {
      const target = mutableRacers.find((racer) => racer.id === shot.toId)
      if (!target || target.finished) {
        pendingLogs.push(`${shot.attackerName}의 당근이 빗나갔습니다.`)
        return
      }

      const targetProgress = raceDistance > 0 ? (target.position / raceDistance) * 100 : 0
      const targetPoint = getTrackPointFromProgress(shot.toId, targetProgress)
      if (!targetPoint) {
        nextShots.push(shot)
        return
      }

      const dx = targetPoint.x - shot.x
      const dy = targetPoint.y - shot.y
      const distance = Math.hypot(dx, dy)
      const directionDeg = Math.atan2(dy, dx) * (180 / Math.PI)

      if (distance <= CARROT_HIT_DISTANCE_PX) {
        resolveProjectileImpact(shot, mutableRacers, now, pendingLogs)
        return
      }

      const projectileSpeedPxPerMs = Math.min(
        CARROT_PROJECTILE_MAX_SPEED_PX_PER_MS,
        CARROT_PROJECTILE_SPEED_PX_PER_MS + distance * CARROT_PROJECTILE_DISTANCE_ACCEL_PER_PX_PER_MS
      )
      const stepPx = Math.max(4, projectileSpeedPxPerMs * elapsedMs)
      const moveDistance = Math.min(stepPx, Math.max(distance, 0))
      const unitX = distance > 0 ? dx / distance : 0
      const unitY = distance > 0 ? dy / distance : 0
      const nextX = shot.x + unitX * moveDistance
      const nextY = shot.y + unitY * moveDistance

      const segDx = nextX - shot.x
      const segDy = nextY - shot.y
      const segLenSq = segDx * segDx + segDy * segDy
      let t = 0
      if (segLenSq > 0) {
        t = ((targetPoint.x - shot.x) * segDx + (targetPoint.y - shot.y) * segDy) / segLenSq
        t = Math.max(0, Math.min(1, t))
      }
      const closestX = shot.x + segDx * t
      const closestY = shot.y + segDy * t
      const closestDist = Math.hypot(targetPoint.x - closestX, targetPoint.y - closestY)

      if (closestDist <= CARROT_HIT_DISTANCE_PX) {
        resolveProjectileImpact(shot, mutableRacers, now, pendingLogs)
        return
      }

      nextShots.push({
        ...shot,
        x: nextX,
        y: nextY,
        angleDeg: directionDeg + 32
      })
    })

    return nextShots
  }, [getTrackPointFromProgress, raceDistance, resolveProjectileImpact])

  const emitProjectiles = useCallback((requests) => {
    if (!requests.length) return

    const now = performance.now()
    const spawned = []

    requests.forEach((request) => {
      const startPoint = getTrackPointFromProgress(request.fromId, request.fromProgress)
      const targetPoint = getTrackPointFromProgress(request.toId, request.toProgress)
      if (!startPoint || !targetPoint) return

      const directionDeg = Math.atan2(targetPoint.y - startPoint.y, targetPoint.x - startPoint.x) * (180 / Math.PI)
      spawned.push({
        id: projectileSeqRef.current++,
        fromId: request.fromId,
        toId: request.toId,
        attackerName: request.attackerName,
        x: startPoint.x,
        y: startPoint.y,
        angleDeg: directionDeg + 32,
        createdAt: now
      })
    })

    if (!spawned.length) return

    spawned.forEach(() => {
      playSfx(throwingSfxRef, 0.74)
    })
    const nextShots = [...projectilesRef.current, ...spawned]
    projectilesRef.current = nextShots
    setProjectiles(nextShots)
  }, [getTrackPointFromProgress, playSfx])

  const spawnDizzyCliffEvents = useCallback((racersSnapshot, hazardsDraft, eventTime, pendingLogs) => {
    const activeRacers = racersSnapshot.filter((racer) => !racer.finished)
    if (!activeRacers.length) return

    if (Math.random() < effectiveSkillChance.boulder) {
      const topRacers = [...activeRacers]
        .sort((a, b) => b.position - a.position)
        .slice(0, Math.min(2, activeRacers.length))
      const laneRacer = topRacers[Math.floor(Math.random() * topRacers.length)]
      const startRatio = 0.82 + Math.random() * 0.16
      const speed = raceDistance * (0.1 + Math.random() * 0.06)
      hazardsDraft.push({
        id: `boulder-${hazardSeqRef.current++}`,
        type: 'boulder',
        laneId: laneRacer.id,
        position: raceDistance * startRatio,
        speed,
        angleDeg: -24 + Math.random() * 48,
        createdAt: eventTime
      })
      pendingLogs.push(`낙석 발생! ${laneRacer.name} 라인으로 바위가 굴러옵니다.`)
    }

    if (Math.random() < effectiveSkillChance.mud) {
      const laneRacer = activeRacers[Math.floor(Math.random() * activeRacers.length)]
      const mudRatio = 0.2 + Math.random() * 0.62
      hazardsDraft.push({
        id: `mud-${hazardSeqRef.current++}`,
        type: 'mud',
        laneId: laneRacer.id,
        position: raceDistance * mudRatio,
        expiresAt: eventTime + MUD_LIFETIME_MS
      })
      pendingLogs.push(`진흙탕 생성! ${laneRacer.name} 라인에 진흙탕이 생겼습니다.`)
    }
  }, [effectiveSkillChance.boulder, effectiveSkillChance.mud, raceDistance])

  const updateMapHazards = useCallback((hazardsPrev, racersSnapshot, now, tickSeconds, pendingLogs) => {
    const nextHazards = []

    hazardsPrev.forEach((hazard) => {
      const laneRacer = racersSnapshot.find((racer) => racer.id === hazard.laneId)

      if (hazard.type === 'boulder') {
        const nextPosition = hazard.position - hazard.speed * tickSeconds
        if (nextPosition <= 0) return
        if (!laneRacer || laneRacer.finished) {
          nextHazards.push({ ...hazard, position: nextPosition })
          return
        }

        const hitRange = Math.max(18, raceDistance * 0.015)
        if (Math.abs(laneRacer.position - nextPosition) <= hitRange) {
          const shieldActive = laneRacer.shieldUntil > now && laneRacer.shieldCharges > 0
          if (shieldActive) {
            laneRacer.shieldCharges = 0
            laneRacer.shieldUntil = now
            laneRacer.isShieldActive = false
            applyRacerEvent(laneRacer, '방어', 12)
            pendingLogs.push(`${laneRacer.name}이(가) 낙석을 실드로 막아냈습니다.`)
          } else {
            laneRacer.stunUntil = now + BOULDER_STUN_DURATION_MS
            applyRacerEvent(laneRacer, '기절', 12)
            laneRacer.status = '기절'
            playSfx(stunSfxRef, 0.8)
            pendingLogs.push(`${laneRacer.name}이(가) 낙석에 맞아 3초 기절했습니다.`)
          }
          return
        }

        nextHazards.push({ ...hazard, position: nextPosition })
        return
      }

      if (hazard.type === 'mud') {
        if (hazard.expiresAt <= now) return
        if (!laneRacer || laneRacer.finished) {
          nextHazards.push(hazard)
          return
        }

        const triggerRange = Math.max(14, raceDistance * 0.012)
        if (Math.abs(laneRacer.position - hazard.position) <= triggerRange) {
          laneRacer.slowUntil = Math.max(laneRacer.slowUntil, now + MUD_SLOW_DURATION_MS)
          laneRacer.isSlowed = true
          applyRacerEvent(laneRacer, '감속', 12)
          pendingLogs.push(`${laneRacer.name}이(가) 진흙탕에 빠져 3초간 50% 감속됩니다.`)
          return
        }

        nextHazards.push(hazard)
      }
    })

    return nextHazards
  }, [playSfx, raceDistance])

  const runSkillRollForRacer = useCallback((racer, mutableRacers, now, pendingLogs, pendingShots) => {
    if (racer.finished) return 'skipped'
    if (racer.stunUntil > now) return 'skipped'
    let usedSkill = false

    if (Math.random() < effectiveSkillChance.attack) {
      const targets = mutableRacers.filter((candidate) => {
        if (candidate.id === racer.id || candidate.finished) return false
        return candidate.position > racer.position + 2
      })

      if (targets.length) {
        const target = targets[Math.floor(Math.random() * targets.length)]
        pendingShots.push({
          fromId: racer.id,
          toId: target.id,
          attackerName: racer.name,
          fromProgress: (racer.position / raceDistance) * 100,
          toProgress: (target.position / raceDistance) * 100
        })
        applyRacerEvent(racer, '공격', 10)
        pendingLogs.push(`${racer.name}이(가) ${target.name}에게 당근을 던졌습니다.`)
        usedSkill = true
      }
    }

    if (Math.random() < effectiveSkillChance.shield) {
      racer.shieldUntil = now + SHIELD_DURATION_MS
      racer.shieldCharges = 1
      racer.isShieldActive = true
      applyRacerEvent(racer, '실드', 10)
      pendingLogs.push(`${racer.name}이(가) 3초 실드를 사용했습니다.`)
      usedSkill = true
    }

    if (Math.random() < effectiveSkillChance.boost) {
      racer.boostPendingCycle = true
      applyRacerEvent(racer, '부스트', 10)
      playSfx(boostSfxRef, 0.78)
      pendingLogs.push(`${racer.name}이(가) 다음 스킬 시도까지 부스트를 사용합니다.`)
      usedSkill = true
    }

    return usedSkill ? 'used' : 'none'
  }, [effectiveSkillChance.attack, effectiveSkillChance.boost, effectiveSkillChance.shield, playSfx, raceDistance])

  const resetRace = useCallback(() => {
    setIsRunning(false)
    setRankingIds([])
    setProjectiles([])
    projectilesRef.current = []
    setMapHazards([])
    setSkillLogs([])
    setResultPopup({ open: false, entries: [] })
    startTimeRef.current = 0
    nextMapEventAtRef.current = 0
    lastTickAtRef.current = 0
    finishOrderRef.current = []
    hazardSeqRef.current = 1
    logSeqRef.current = 1
    clearProjectileTimers()
    mapHazardsRef.current = []
    const nextRacers = createInitialRacers(parsedPetNames, racersRef.current)
    racersRef.current = nextRacers
    setRacers(nextRacers)
  }, [clearProjectileTimers, parsedPetNames])

  const selectPetType = useCallback((racerId, petType) => {
    if (isRunning) return
    const nextRacers = racersRef.current.map((racer) =>
        racer.id === racerId
          ? { ...racer, petType }
          : racer
    )
    racersRef.current = nextRacers
    setRacers(nextRacers)
  }, [isRunning])

  const startRace = useCallback(() => {
    if (isRunning || !parsedPetNames.length) return
    const now = performance.now()
    startTimeRef.current = now
    lastTickAtRef.current = now
    finishOrderRef.current = []
    nextMapEventAtRef.current = now + MAP_EVENT_TICK_MS
    hazardSeqRef.current = 1
    clearProjectileTimers()
    setRankingIds([])
    setProjectiles([])
    projectilesRef.current = []
    setMapHazards([])
    mapHazardsRef.current = []
    setResultPopup({ open: false, entries: [] })
    setSkillLogs([
      { id: logSeqRef.current++, time: '00:00', message: '경주가 시작되었습니다.' }
    ])
    const nextRacers = createInitialRacers(parsedPetNames, racersRef.current).map((racer) => ({
        ...racer,
        nextSkillRollAt: now + racer.skillTickOffsetMs,
        skillCooldownStartAt: now,
        skillCooldownDurationMs: Math.max(1, racer.skillTickOffsetMs),
        cooldownPaused: false,
        cooldownPauseRemainingMs: 0,
        lastAilmentUntil: 0,
        status: '질주'
      }))
    racersRef.current = nextRacers
    setRacers(nextRacers)
    restartPlayingBgmRef.current = true
    setIsTopPanelsCollapsed(true)
    setIsRunning(true)
  }, [clearProjectileTimers, isRunning, parsedPetNames])

  const tickRace = useCallback(() => {
    const now = performance.now()
    const elapsedMs = lastTickAtRef.current > 0 ? Math.max(16, Math.min(280, now - lastTickAtRef.current)) : RACE_TICK_MS
    const tickSeconds = elapsedMs / 1000
    const eventTickDecay = Math.max(1, Math.round(elapsedMs / RACE_TICK_MS))
    lastTickAtRef.current = now
    const pendingLogs = []
    const pendingShots = []

    const next = racersRef.current.map((racer) => {
      const keepFinishRankLabel = racer.finished && /\d+등$/.test(racer.eventText || '')
      if (keepFinishRankLabel) {
        return { ...racer }
      }
      return {
        ...racer,
        eventTicks: Math.max(0, racer.eventTicks - eventTickDecay),
        eventText: racer.eventTicks > eventTickDecay ? racer.eventText : ''
      }
    })

    next.forEach((racer) => {
      if (racer.finished) return

      const ailmentUntil = Math.max(racer.stunUntil || 0, racer.slowUntil || 0)
      const ailmentActive = ailmentUntil > now
      if (ailmentActive) {
        const isNewAilment = ailmentUntil > (racer.lastAilmentUntil || 0) + 1
        if (isNewAilment) {
          const resetCooldownMs = getRandomSkillTickMs()
          racer.skillCooldownDurationMs = resetCooldownMs
          racer.skillCooldownStartAt = now
          racer.nextSkillRollAt = now + resetCooldownMs
          racer.cooldownPauseRemainingMs = resetCooldownMs
          racer.cooldownPaused = true
          racer.runUntil = 0
        } else if (!racer.cooldownPaused) {
          racer.cooldownPauseRemainingMs = Math.max(
            1,
            (Number(racer.nextSkillRollAt) || now) - now
          )
          racer.cooldownPaused = true
        }
        racer.lastAilmentUntil = ailmentUntil
      } else {
        if (racer.cooldownPaused) {
          const resumeRemainingMs = Math.max(
            1,
            Number(racer.cooldownPauseRemainingMs) || Number(racer.skillCooldownDurationMs) || getRandomSkillTickMs()
          )
          racer.cooldownPaused = false
          racer.cooldownPauseRemainingMs = 0
          racer.skillCooldownStartAt = now
          racer.skillCooldownDurationMs = resumeRemainingMs
          racer.nextSkillRollAt = now + resumeRemainingMs
        }
        racer.lastAilmentUntil = 0
      }

      if (racer.cooldownPaused) return

      if (!Number.isFinite(racer.nextSkillRollAt) || racer.nextSkillRollAt <= 0) {
        const initialDelay = Math.max(1, racer.skillTickOffsetMs || getRandomSkillTickMs())
        racer.skillCooldownStartAt = now
        racer.skillCooldownDurationMs = initialDelay
        racer.cooldownPauseRemainingMs = 0
        racer.nextSkillRollAt = now + initialDelay
      }
      while (!racer.finished && now >= racer.nextSkillRollAt) {
        const rollAt = racer.nextSkillRollAt
        const rollResult = runSkillRollForRacer(racer, next, now, pendingLogs, pendingShots)
        const nextTickMs = getRandomSkillTickMs()
        racer.skillCooldownStartAt = rollAt
        racer.skillCooldownDurationMs = nextTickMs
        racer.nextSkillRollAt = rollAt + nextTickMs
        if (racer.boostPendingCycle) {
          racer.boostUntil = rollAt + nextTickMs
          racer.boostPendingCycle = false
        }
        if (rollResult === 'none') {
          racer.runUntil = rollAt + nextTickMs
          applyRacerEvent(racer, '달려!', Math.max(8, Math.round(nextTickMs / RACE_TICK_MS)))
          pendingLogs.push(`${racer.name}이(가) 달려 상태로 질주합니다.`)
        } else {
          racer.runUntil = 0
        }
      }
    })

    let nextHazards = mapHazardsRef.current.map((hazard) => ({ ...hazard }))
    if (selectedMap === MAP_DIZZY_CLIFF) {
      if (!Number.isFinite(nextMapEventAtRef.current) || nextMapEventAtRef.current <= 0) {
        nextMapEventAtRef.current = now + MAP_EVENT_TICK_MS
      }
      while (now >= nextMapEventAtRef.current) {
        spawnDizzyCliffEvents(next, nextHazards, nextMapEventAtRef.current, pendingLogs)
        nextMapEventAtRef.current += MAP_EVENT_TICK_MS
      }
      nextHazards = updateMapHazards(nextHazards, next, now, tickSeconds, pendingLogs)
    } else {
      nextHazards = []
    }

    next.forEach((racer) => {
      if (racer.finished) return

      const stunned = racer.stunUntil > now
      const boosted = racer.boostUntil > now
      const slowed = racer.slowUntil > now
      const running = racer.runUntil > now
      const shielded = racer.shieldUntil > now && racer.shieldCharges > 0
      if (racer.shieldUntil <= now) {
        racer.shieldCharges = 0
      }
      if (racer.slowUntil <= now) {
        racer.slowUntil = 0
      }
      racer.isShieldActive = shielded
      racer.isSlowed = slowed

      let speed = 0
      let nextPosition = racer.position

      if (!stunned) {
        const pace = 0.86 + Math.random() * 0.32
        speed = racer.baseSpeed * pace * (boosted ? 2 : (running ? 1.3 : 1)) * (slowed ? 0.5 : 1)
        nextPosition = Math.min(raceDistance, racer.position + speed * tickSeconds)
      }

      const finished = nextPosition >= raceDistance
      let finishTime = racer.finishTime
      if (finished && !racer.finished) {
        finishTime = now - startTimeRef.current
        finishOrderRef.current.push(racer.id)
        applyRacerEvent(racer, `${finishOrderRef.current.length}등`, 12)
        pendingLogs.push(`${racer.name}이(가) 완주했습니다. (${formatRaceDuration(finishTime)})`)
      }

      let status = '질주'
      if (finished) status = '완주'
      else if (stunned) status = '기절'
      else if (boosted) status = '부스트'
      else if (slowed) status = '감속'
      else if (shielded) status = '실드'
      else if (running) status = '달려!'

      racer.position = nextPosition
      racer.speed = speed
      racer.status = status
      racer.finished = finished
      racer.finishTime = finishTime
    })

    emitProjectiles(pendingShots)
    const nextProjectiles = updateProjectiles(projectilesRef.current, next, now, elapsedMs, pendingLogs)
    if (nextProjectiles !== projectilesRef.current) {
      projectilesRef.current = nextProjectiles
      setProjectiles(nextProjectiles)
    }

    const everyoneFinished = next.every((racer) => racer.finished)
    racersRef.current = next
    setRacers(next)
    mapHazardsRef.current = nextHazards
    setMapHazards(nextHazards)

    appendSkillLogs(pendingLogs, now)

    if (everyoneFinished) {
      const finalRanking = [...finishOrderRef.current]
      const byId = new Map(next.map((racer) => [racer.id, racer]))
      const popupEntries = finalRanking
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((racer) => ({
          id: racer.id,
          name: racer.name,
          finishTime: racer.finishTime
        }))

      lastTickAtRef.current = 0
      clearProjectileTimers()
      setProjectiles([])
      projectilesRef.current = []
      setIsRunning(false)
      setRankingIds(finalRanking)
      setResultPopup({ open: true, entries: popupEntries })
    }
  }, [appendSkillLogs, clearProjectileTimers, emitProjectiles, getRandomSkillTickMs, raceDistance, runSkillRollForRacer, selectedMap, spawnDizzyCliffEvents, updateMapHazards, updateProjectiles])

  useEffect(() => {
    if (!isRunning) return undefined
    const interval = window.setInterval(tickRace, RACE_TICK_MS)
    return () => window.clearInterval(interval)
  }, [isRunning, tickRace])

  useEffect(() => {
    syncRacingBgm()
  }, [syncRacingBgm])

  useEffect(() => {
    const scrollNode = trackScrollRef.current
    if (!isRunning || !autoScrollEnabled || !scrollNode) {
      stopTrackAutoScrollLoop()
      return undefined
    }

    autoScrollTargetRef.current = scrollNode.scrollLeft
    let prevTs = performance.now()

    const animate = (ts) => {
      const node = trackScrollRef.current
      const trackNode = trackWrapRef.current
      if (!node || !trackNode) {
        autoScrollFrameRef.current = 0
        return
      }

      const dt = Math.max(8, Math.min(48, ts - prevTs))
      prevTs = ts

      const racersSnapshot = racersRef.current
      const runningRacers = racersSnapshot.filter((racer) => !racer.finished)
      if (!runningRacers.length) {
        autoScrollFrameRef.current = window.requestAnimationFrame(animate)
        return
      }

      let focusedRacer = runningRacers[0]
      for (let i = 1; i < runningRacers.length; i += 1) {
        if (runningRacers[i].position > focusedRacer.position) {
          focusedRacer = runningRacers[i]
        }
      }

      const tickAgeMs = lastTickAtRef.current > 0
        ? Math.max(0, Math.min(RACE_TICK_MS * 1.3, ts - lastTickAtRef.current))
        : 0
      const canProjectMove = focusedRacer.stunUntil <= ts && !focusedRacer.finished
      const projectedPosition = canProjectMove
        ? Math.min(raceDistance, focusedRacer.position + focusedRacer.speed * (tickAgeMs / 1000))
        : focusedRacer.position
      const focusedRatio = raceDistance > 0
        ? Math.max(0, Math.min(1, projectedPosition / raceDistance))
        : 0
      const trackWidth = Math.max(1, trackNode.clientWidth)
      const runnerX = 12 + focusedRatio * Math.max(0, trackWidth - 22)

      const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth)
      const lookAheadPx = Math.max(22, Math.min(170, focusedRacer.speed * 0.5))
      const targetScrollLeftRaw = runnerX - node.clientWidth * 0.44 + lookAheadPx
      const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeftRaw))
      const targetSmoothing = 1 - Math.exp(-dt / 120)
      autoScrollTargetRef.current += (targetScrollLeft - autoScrollTargetRef.current) * targetSmoothing

      const delta = autoScrollTargetRef.current - node.scrollLeft
      if (Math.abs(delta) > 0.05) {
        const smoothing = 1 - Math.exp(-dt / 82)
        const next = node.scrollLeft + delta * smoothing
        node.scrollLeft = Math.max(0, Math.min(maxScrollLeft, next))
      } else if (Math.abs(delta) > 0) {
        node.scrollLeft = autoScrollTargetRef.current
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(animate)
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(animate)
    return () => {
      stopTrackAutoScrollLoop()
    }
  }, [autoScrollEnabled, isRunning, raceDistance, stopTrackAutoScrollLoop, trackWorldWidth])

  useEffect(() => {
    const logNode = skillLogRef.current
    if (!logNode) return
    logNode.scrollTop = logNode.scrollHeight
  }, [skillLogs])

  useEffect(() => {
    return () => {
      cancelBgmFade()
      stopTrackAutoScrollLoop()
      clearProjectileTimers()
      const waitingAudio = waitingBgmRef.current
      const playingAudio = playingBgmRef.current
      if (waitingAudio) {
        waitingAudio.pause()
        waitingAudio.currentTime = 0
      }
      if (playingAudio) {
        playingAudio.pause()
        playingAudio.currentTime = 0
      }
    }
  }, [cancelBgmFade, clearProjectileTimers, stopTrackAutoScrollLoop])

  return (
    <>
      <section className='card racing-card' style={racingCardBackgroundStyle}>
      <div className='racing-top-toggle'>
        <button
          className='btn ghost tiny racing-collapse-btn'
          onClick={() => setIsTopPanelsCollapsed((prev) => !prev)}
        >
          {isTopPanelsCollapsed ? '메뉴 펼치기' : '메뉴 접기'}
        </button>
      </div>
      <div className={`racing-head-wrap ${isTopPanelsCollapsed ? 'collapsed' : ''}`}>
        <div className='racing-head'>
          <div className='racing-config-panel'>
            <h2 className='racing-title'>달려달려</h2>
            <p className='racing-subtitle'>토끼 펫들이 스킬을 쓰며 경쟁하는 자동 레이스</p>
            <div className='pet-name-input-wrap'>
              <label htmlFor='pet-name-input'>참가 펫 이름 (콤마 구분)</label>
              <div className='pet-name-input-row'>
                <input
                  id='pet-name-input'
                  className='input-text pet-name-input'
                  placeholder='예: A, B, C, D'
                  value={petNamesInput}
                  onChange={(e) => setPetNamesInput(e.target.value)}
                  disabled={isRunning}
                />
                <button
                  className='btn ghost pet-name-shuffle-btn'
                  onClick={shufflePetNamesInput}
                  disabled={isRunning || parsedPetNames.length < 2}
                >
                  {`섞기(${parsedPetNames.length})`}
                </button>
              </div>
            </div>
          </div>
          <div className='racing-actions-panel'>
            <div className='racing-actions'>
              <button className='btn primary' onClick={startRace} disabled={isRunning || !racers.length}>경주 시작</button>
              <button className='btn ghost' onClick={resetRace}>초기화</button>
              <button className='btn ghost' onClick={toggleRacingBgm}>
                {bgmEnabled ? '브금 끄기' : '브금 켜기'}
              </button>
              <button className='btn ghost' onClick={toggleRacingSfx}>
                {sfxEnabled ? '효과음 끄기' : '효과음 켜기'}
              </button>
            </div>
            <div className='racing-track-options'>
              <div className='racing-track-options-title'>트랙 옵션</div>
              <div className='race-config-row'>
                <div className='race-config-field'>
                  <label htmlFor='track-length-input'>트랙 길이</label>
                  <input
                    id='track-length-input'
                    className='input-text pet-name-input'
                    value={trackLengthInput}
                    onChange={(e) => setTrackLengthInput(e.target.value)}
                    disabled={isRunning}
                  />
                </div>
                <div className='race-config-field'>
                  <label htmlFor='map-select-input'>맵 선택</label>
                  <select
                    id='map-select-input'
                    className='input-text pet-name-input'
                    value={selectedMap}
                    onChange={(e) => setSelectedMap(e.target.value)}
                    disabled={isRunning}
                  >
                    <option value={MAP_DEFAULT}>기본</option>
                    <option value={MAP_DIZZY_CLIFF}>어질어질한 절벽</option>
                  </select>
                </div>
              </div>
              <button className='btn ghost skill-info-btn' onClick={openSkillInfoPopup}>
                스킬 설정
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className='racing-meta'>
        <span className={`race-state ${isRunning ? 'running' : raceCompleted ? 'finished' : ''}`}>
          {isRunning ? '경주 진행중' : raceCompleted ? '경주 종료' : '대기'}
        </span>
        <span>선두: {raceLeader?.name ?? '-'}</span>
        <span>트랙 길이: {raceDistance}</span>
        <span>맵: {getMapLabel(selectedMap)}</span>
        <label className='race-auto-scroll-toggle'>
          <input
            type='checkbox'
            checked={autoScrollEnabled}
            onChange={(e) => setAutoScrollEnabled(e.target.checked)}
          />
          자동 스크롤
        </label>
      </div>

      <div className='race-track-wrap'>
        {!racerRows.length ? (
          <div className='race-empty-state'>참가 펫 이름을 입력하면 레이스에 배치됩니다.</div>
        ) : (
          <div
            className={`race-unified-layout ${isRunning ? 'is-running' : ''}`}
            style={{ '--lane-count': racerRows.length, '--track-world-width': `${trackWorldWidth}px` }}
          >
            <div className='race-roster'>
              {racerRows.map(({ racer, idx, progress }) => (
                <article key={racer.id} className='race-roster-item'>
                  <div className='race-roster-head'>
                    <strong>#{idx + 1}</strong>
                    <span>{racer.name}</span>
                  </div>
                  {!isRunning ? (
                    <div className='pet-picker'>
                      <button
                        className={`pet-option ${racer.petType === PET_TYPE_RABBIT ? 'active' : ''}`}
                        onClick={() => selectPetType(racer.id, PET_TYPE_RABBIT)}
                        title='토끼 선택'
                      >
                        <RabbitRacerIcon accentColor={racer.color} compact />
                        <span>토끼</span>
                      </button>
                      <button
                        className={`pet-option ${racer.petType === PET_TYPE_HORSE ? 'active' : ''}`}
                        onClick={() => selectPetType(racer.id, PET_TYPE_HORSE)}
                        title='말 선택'
                      >
                        <HorseRacerIcon accentColor={racer.color} compact />
                        <span>말</span>
                      </button>
                    </div>
                  ) : (
                    <span className='pet-type-text'>{racer.petType === PET_TYPE_HORSE ? '말' : '토끼'}</span>
                  )}
                  <div className='race-roster-stats'>
                    <span>{Math.round(progress)}%</span>
                    <span>{racer.finished ? formatRaceDuration(racer.finishTime) : `${Math.round(racer.speed)} 속도`}</span>
                    <span className='race-status'>{racer.status}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className='race-unified-track-scroll' ref={trackScrollRef}>
              <div className='race-unified-track' ref={trackWrapRef}>
                <div className='race-lane-finish race-unified-finish'>도착</div>
                {racerRows.map(({ racer, idx, eventClass, runnerLeft, cooldownProgressPercent, cooldownText, isStunned, isBoosted, isRunningState }) => {
                  const laneHazards = mapHazards.filter((hazard) => hazard.laneId === racer.id)
                  const petVisualClassName = [
                    'race-pet-visual',
                    racer.isShieldActive ? 'shielded' : '',
                    isStunned ? 'stunned' : '',
                    isBoosted ? 'boosted' : '',
                    isRunningState ? 'running' : ''
                  ].filter(Boolean).join(' ')
                  const laneSceneryOffset = (idx * LANE_SCENERY_LANE_OFFSET_PERCENT) % 18
                  const laneSceneryBase = -laneSceneryOffset
                  return (
                    <div
                      key={racer.id}
                      className='race-unified-lane'
                      style={{
                        '--lane-pattern-shift': `${(idx * 120) % 220}px`,
                        '--lane-scene-x-shift': `${((idx * 73) % 260) - 130}px`,
                        '--lane-scene-y-shift': `${(idx - (racerRows.length - 1) / 2) * 9}px`
                      }}
                      ref={(node) => { trackRefs.current[racer.id] = node }}
                    >
                      <span className='race-unified-index'>#{idx + 1}</span>
                      <span className='race-lane-scenery' aria-hidden='true'>
                        {LANE_SCENERY_POSITIONS.map((position, sceneryIdx) => {
                          const sceneSeed = idx * 37 + sceneryIdx * 17
                          const shifted = position + laneSceneryBase
                          const wrapped = shifted < 0 ? shifted + 120 : shifted
                          const sceneScale = 0.9 + ((sceneSeed % 24) / 100)
                          const sceneYOffset = (sceneSeed % 11) - 5
                          const sceneOpacity = 0.48 + ((sceneSeed % 16) / 100)
                          const sceneVariant = sceneSeed % 4
                          const sceneClass = sceneSeed % 3 === 0 ? 'is-back' : sceneSeed % 3 === 1 ? 'is-mid' : 'is-front'
                          return (
                            <span
                              key={`${racer.id}-scene-${sceneryIdx}`}
                              className={`race-lane-scenery-item ${sceneClass}`}
                              style={{
                                left: `${wrapped}%`,
                                '--scene-scale': sceneScale.toFixed(2),
                                '--scene-y': `${sceneYOffset}px`,
                                '--scene-opacity': sceneOpacity.toFixed(2)
                              }}
                            >
                              <LaneSceneryMark mapId={selectedMap} variant={sceneVariant} />
                            </span>
                          )
                        })}
                      </span>
                      {laneHazards.map((hazard) => {
                        const hazardRatio = raceDistance > 0 ? hazard.position / raceDistance : 0
                        const hazardPercent = Math.max(0, Math.min(100, hazardRatio * 100))
                        const hazardLeft = `clamp(20px, ${hazardPercent}%, calc(100% - 20px))`

                        if (hazard.type === 'boulder') {
                          return (
                            <span
                              key={hazard.id}
                              className='map-hazard map-hazard-boulder'
                              style={{ left: hazardLeft, '--boulder-angle': `${hazard.angleDeg}deg` }}
                              aria-hidden='true'
                            >
                              <span className='map-hazard-boulder-spin'>
                                <BoulderHazardIcon />
                              </span>
                            </span>
                          )
                        }

                        return (
                          <span key={hazard.id} className='map-hazard map-hazard-mud' style={{ left: hazardLeft }} aria-hidden='true'>
                            <MudHazardIcon />
                          </span>
                        )
                      })}
                      <div className='race-unified-runner' style={{ left: runnerLeft }}>
                        {isRunning ? <span className='race-runner-name'>{racer.name}</span> : null}
                        {racer.eventText ? (
                          <span key={`${racer.id}-${racer.eventSeq || 0}`} className={`race-event ${eventClass}`}>
                            {racer.eventText}
                          </span>
                        ) : null}
                        <div className={petVisualClassName}>
                          {racer.petType === PET_TYPE_HORSE ? (
                            <HorseRacerIcon accentColor={racer.color} />
                          ) : (
                            <RabbitRacerIcon accentColor={racer.color} />
                          )}
                        </div>
                        {isRunning && !racer.finished ? (
                          <span className='race-cooldown-wrap'>
                            <span className='race-cooldown-fill' style={{ width: `${cooldownProgressPercent}%` }} />
                            <span className='race-cooldown-text'>{cooldownText}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}

                {projectiles.map((shot) => (
                  <span
                    key={shot.id}
                    className='carrot-shot'
                    style={{
                      left: `${shot.x}px`,
                      top: `${shot.y}px`,
                      '--shot-rotate': `${shot.angleDeg}deg`
                    }}
                    aria-hidden='true'
                  >
                    <CarrotProjectileIcon />
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <audio ref={waitingBgmRef} src={SOUND_SOURCES.bgmWaiting} preload='auto' loop />
      <audio ref={playingBgmRef} src={SOUND_SOURCES.bgmPlaying} preload='auto' loop />
      <audio ref={throwingSfxRef} src={SOUND_SOURCES.throwing} preload='auto' />
      <audio ref={boostSfxRef} src={SOUND_SOURCES.boost} preload='auto' />
      <audio ref={stunSfxRef} src={SOUND_SOURCES.stun} preload='auto' />
      <audio ref={shieldBreakSfxRef} src={SOUND_SOURCES.shield} preload='auto' />

      {raceCompleted ? (
        <section className='race-ranking'>
          <h3>최종 순위</h3>
          <ol>
            {rankingEntries.map((racer, idx) => (
              <li key={racer.id}>
                <span>{idx + 1}등 - {racer.name}</span>
                <strong>{formatRaceDuration(racer.finishTime)}</strong>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

        <section className='race-log-card'>
          <h3>스킬 로그</h3>
          <div className='race-log-list' ref={skillLogRef}>
            {skillLogs.length ? (
              skillLogs.map((log) => (
                <div key={log.id} className='race-log-item'>
                  <span className='race-log-time'>[{log.time}]</span>
                  <span>{log.message}</span>
                </div>
              ))
            ) : (
              <div className='race-log-empty'>경주 시작 후 스킬 로그가 표시됩니다.</div>
            )}
          </div>
        </section>
      </section>

      {resultPopup.open ? (
        <div className='dialog-backdrop' onClick={closeResultPopup}>
          <div className='dialog race-result-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>최종 결과</h4>
            <ol className='race-result-list'>
              {resultPopup.entries.map((entry, idx) => (
                <li key={entry.id}>
                  <span>{idx + 1}등 - {entry.name}</span>
                  <strong>{formatRaceDuration(entry.finishTime)}</strong>
                </li>
              ))}
            </ol>
            <div className='dialog-actions'>
              <button className='btn primary' onClick={closeResultPopup}>확인</button>
            </div>
          </div>
        </div>
      ) : null}

      {skillInfoPopupOpen ? (
        <div className='dialog-backdrop' onClick={closeSkillInfoPopup}>
          <div className='dialog race-skill-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>스킬 설정</h4>
            <table className='race-skill-table'>
              <thead>
                <tr>
                  <th>항목</th>
                  <th>효과</th>
                  <th>확률</th>
                  <th>지속</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>스킬 사용 빈도</td>
                  <td>각 펫이 스킬 판정을 시도하는 간격</td>
                  <td>
                    <div className='race-skill-range-grid'>
                      <div className='race-skill-prob-wrap race-skill-range-wrap'>
                        <span>최소</span>
                        <input
                          className='input-text compact race-skill-prob-input'
                          type='number'
                          min={MIN_SKILL_TICK_SEC}
                          max={MAX_SKILL_TICK_SEC}
                          step='0.1'
                          value={skillTickRangeSec.min}
                          onChange={(e) => updateSkillTickRangeSec('min', e.target.value)}
                        />
                        <span>초</span>
                      </div>
                      <div className='race-skill-prob-wrap race-skill-range-wrap'>
                        <span>최대</span>
                        <input
                          className='input-text compact race-skill-prob-input'
                          type='number'
                          min={MIN_SKILL_TICK_SEC}
                          max={MAX_SKILL_TICK_SEC}
                          step='0.1'
                          value={skillTickRangeSec.max}
                          onChange={(e) => updateSkillTickRangeSec('max', e.target.value)}
                        />
                        <span>초</span>
                      </div>
                    </div>
                  </td>
                  <td>{`${effectiveSkillTickRange.minSec.toFixed(1)}~${effectiveSkillTickRange.maxSec.toFixed(1)}초`}</td>
                  <td>매 판정 이후 설정 범위에서 랜덤 재설정</td>
                </tr>
                <tr>
                  <td>공격</td>
                  <td>앞선 대상 1명에게 당근 투척</td>
                  <td>
                    <div className='race-skill-prob-wrap'>
                      <input
                        className='input-text compact race-skill-prob-input'
                        type='number'
                        min='0'
                        max='100'
                        step='1'
                        value={skillChancePercent.attack}
                        onChange={(e) => updateSkillChancePercent('attack', e.target.value)}
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td>즉시</td>
                  <td>적중 시 2초 기절</td>
                </tr>
                <tr>
                  <td>실드</td>
                  <td>피격 1회 무효</td>
                  <td>
                    <div className='race-skill-prob-wrap'>
                      <input
                        className='input-text compact race-skill-prob-input'
                        type='number'
                        min='0'
                        max='100'
                        step='1'
                        value={skillChancePercent.shield}
                        onChange={(e) => updateSkillChancePercent('shield', e.target.value)}
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td>3초</td>
                  <td>피격 시 즉시 해제</td>
                </tr>
                <tr>
                  <td>부스트</td>
                  <td>이동 속도 2배</td>
                  <td>
                    <div className='race-skill-prob-wrap'>
                      <input
                        className='input-text compact race-skill-prob-input'
                        type='number'
                        min='0'
                        max='100'
                        step='1'
                        value={skillChancePercent.boost}
                        onChange={(e) => updateSkillChancePercent('boost', e.target.value)}
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td>다음 스킬 시도까지</td>
                  <td>피격 시 50% 확률 회피 (빈도 설정값 영향)</td>
                </tr>
                <tr>
                  <td>맵: 낙석</td>
                  <td>상위권 2명 중 랜덤 대상으로 골인지점 방향에서 시작 방향으로 굴러옴</td>
                  <td>
                    <div className='race-skill-prob-wrap'>
                      <input
                        className='input-text compact race-skill-prob-input'
                        type='number'
                        min='0'
                        max='100'
                        step='1'
                        value={skillChancePercent.boulder}
                        onChange={(e) => updateSkillChancePercent('boulder', e.target.value)}
                      />
                      <span>%/초</span>
                    </div>
                  </td>
                  <td>충돌까지</td>
                  <td>피격 시 3초 기절</td>
                </tr>
                <tr>
                  <td>맵: 진흙탕</td>
                  <td>진로에 생성된 진흙탕 접촉 시 감속</td>
                  <td>
                    <div className='race-skill-prob-wrap'>
                      <input
                        className='input-text compact race-skill-prob-input'
                        type='number'
                        min='0'
                        max='100'
                        step='1'
                        value={skillChancePercent.mud}
                        onChange={(e) => updateSkillChancePercent('mud', e.target.value)}
                      />
                      <span>%/초</span>
                    </div>
                  </td>
                  <td>3초</td>
                  <td>50% 감속</td>
                </tr>
              </tbody>
            </table>
            <div className='dialog-actions'>
              <button className='btn primary' onClick={closeSkillInfoPopup}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function LaneSceneryMark({ mapId, variant = 0 }) {
  if (mapId === MAP_DIZZY_CLIFF) {
    if (variant === 0) {
      return (
        <svg className='race-lane-scenery-mark is-cliff' viewBox='0 0 30 20' aria-hidden='true'>
          <ellipse cx='15' cy='14.5' rx='12' ry='4.2' fill='rgba(106, 88, 72, 0.9)' />
          <path d='M5 14 L9 10.3 L13 14 Z' fill='rgba(177, 151, 128, 0.84)' />
          <path d='M12 14 L16.6 9.8 L21 14 Z' fill='rgba(190, 166, 143, 0.82)' />
        </svg>
      )
    }
    if (variant === 1) {
      return (
        <svg className='race-lane-scenery-mark is-cliff' viewBox='0 0 30 20' aria-hidden='true'>
          <ellipse cx='15' cy='14.7' rx='11' ry='4' fill='rgba(93, 76, 63, 0.88)' />
          <path d='M7 14 L10.8 9.7 L14.8 14 Z' fill='rgba(159, 134, 112, 0.82)' />
          <path d='M14 14 L18.2 10.2 L22.6 14 Z' fill='rgba(176, 152, 129, 0.8)' />
          <path d='M11.3 12 L12.6 10.8 M17.4 12.4 L18.8 11.2' stroke='rgba(126, 106, 89, 0.72)' strokeWidth='0.8' strokeLinecap='round' />
        </svg>
      )
    }
    if (variant === 2) {
      return (
        <svg className='race-lane-scenery-mark is-cliff' viewBox='0 0 30 20' aria-hidden='true'>
          <ellipse cx='15' cy='14.4' rx='11.5' ry='4.1' fill='rgba(101, 84, 68, 0.9)' />
          <ellipse cx='11' cy='12.4' rx='3.6' ry='2.4' fill='rgba(164, 140, 118, 0.82)' />
          <ellipse cx='16.2' cy='11.8' rx='3.9' ry='2.5' fill='rgba(176, 152, 130, 0.82)' />
          <ellipse cx='21' cy='12.8' rx='3.2' ry='2.1' fill='rgba(160, 135, 112, 0.8)' />
        </svg>
      )
    }
    return (
      <svg className='race-lane-scenery-mark is-cliff' viewBox='0 0 30 20' aria-hidden='true'>
        <ellipse cx='15' cy='14.7' rx='12' ry='4.3' fill='rgba(98, 80, 66, 0.9)' />
        <path d='M4.8 14 L8.4 11 L11.8 14 Z' fill='rgba(170, 146, 124, 0.8)' />
        <path d='M11.6 14 L15 9.6 L18.8 14 Z' fill='rgba(188, 165, 143, 0.84)' />
        <path d='M18 14 L22.2 10.4 L25.4 14 Z' fill='rgba(166, 141, 118, 0.8)' />
      </svg>
    )
  }

  if (variant === 0) {
    return (
      <svg className='race-lane-scenery-mark is-meadow' viewBox='0 0 30 20' aria-hidden='true'>
        <rect x='13.8' y='9' width='2.7' height='7' rx='1.35' fill='rgba(71, 90, 62, 0.95)' />
        <ellipse cx='15.1' cy='8' rx='8.6' ry='5.9' fill='rgba(98, 129, 86, 0.9)' />
        <ellipse cx='10.2' cy='9.2' rx='4.2' ry='3.2' fill='rgba(86, 118, 75, 0.84)' />
        <ellipse cx='20.1' cy='9.1' rx='4.3' ry='3.2' fill='rgba(86, 118, 75, 0.84)' />
        <path d='M3 17 L4.6 13.3 L6.2 17 M8.4 17 L10 13.5 L11.6 17 M20.2 17 L21.8 13.4 L23.4 17 M25 17 L26.6 13.4 L28.2 17' stroke='rgba(188, 220, 170, 0.75)' strokeWidth='1.1' strokeLinecap='round' strokeLinejoin='round' fill='none' />
      </svg>
    )
  }
  if (variant === 1) {
    return (
      <svg className='race-lane-scenery-mark is-meadow' viewBox='0 0 30 20' aria-hidden='true'>
        <ellipse cx='9.8' cy='10.5' rx='5.6' ry='3.7' fill='rgba(90, 122, 77, 0.86)' />
        <ellipse cx='15.3' cy='9.7' rx='6.2' ry='4.1' fill='rgba(100, 133, 88, 0.88)' />
        <ellipse cx='21.1' cy='10.6' rx='5.5' ry='3.6' fill='rgba(88, 121, 76, 0.84)' />
        <path d='M4 17 L5.6 13.2 L7.2 17 M10.6 17 L12.2 13.1 L13.8 17 M17.8 17 L19.4 13.2 L21 17 M24 17 L25.6 13.1 L27.2 17' stroke='rgba(194, 225, 174, 0.74)' strokeWidth='1.1' strokeLinecap='round' strokeLinejoin='round' fill='none' />
      </svg>
    )
  }
  if (variant === 2) {
    return (
      <svg className='race-lane-scenery-mark is-meadow' viewBox='0 0 30 20' aria-hidden='true'>
        <rect x='7.5' y='10' width='2.4' height='6.2' rx='1.2' fill='rgba(69, 88, 60, 0.92)' />
        <ellipse cx='8.7' cy='9.2' rx='4.8' ry='3.4' fill='rgba(96, 126, 84, 0.88)' />
        <rect x='18.5' y='9.2' width='2.6' height='6.9' rx='1.3' fill='rgba(71, 90, 61, 0.94)' />
        <ellipse cx='19.8' cy='8.4' rx='5.4' ry='3.8' fill='rgba(101, 132, 88, 0.9)' />
        <path d='M2.8 17 L4.5 13.3 L6.2 17 M12.8 17 L14.4 13.3 L16 17 M22.6 17 L24.2 13.4 L25.8 17' stroke='rgba(188, 220, 170, 0.72)' strokeWidth='1.05' strokeLinecap='round' strokeLinejoin='round' fill='none' />
      </svg>
    )
  }
  return (
    <svg className='race-lane-scenery-mark is-meadow' viewBox='0 0 30 20' aria-hidden='true'>
      <rect x='13.5' y='9.1' width='2.8' height='7.1' rx='1.4' fill='rgba(70, 89, 61, 0.95)' />
      <ellipse cx='14.9' cy='8.4' rx='9.2' ry='5.8' fill='rgba(102, 134, 89, 0.9)' />
      <ellipse cx='9.3' cy='9.5' rx='4.3' ry='3.2' fill='rgba(88, 120, 76, 0.84)' />
      <ellipse cx='20.7' cy='9.4' rx='4.3' ry='3.2' fill='rgba(88, 120, 76, 0.84)' />
      <circle cx='6.7' cy='6.3' r='1.05' fill='rgba(255, 225, 164, 0.74)' />
      <circle cx='23.5' cy='6.9' r='0.95' fill='rgba(252, 207, 165, 0.72)' />
      <path d='M3.4 17 L5 13.4 L6.6 17 M8.8 17 L10.4 13.5 L12 17 M19.6 17 L21.2 13.4 L22.8 17 M24.8 17 L26.4 13.5 L28 17' stroke='rgba(190, 222, 171, 0.74)' strokeWidth='1.06' strokeLinecap='round' strokeLinejoin='round' fill='none' />
    </svg>
  )
}

function CarrotProjectileIcon() {
  return (
    <svg className='carrot-shot-svg' viewBox='0 0 20 20' aria-hidden='true'>
      <path d='M5 11 L14 5 L11 14 Z' fill='#f58c3b' />
      <path d='M5 11 L11 14 L8 16 L3 12 Z' fill='#de7030' />
      <path d='M12 4 C13.5 2.4, 15.2 2.2, 16.8 2.8 C15.8 3.9, 14.5 4.6, 13.2 5 Z' fill='#66c86b' />
      <path d='M11.2 5.1 C12.2 3.2, 13.6 2.5, 15.2 2.4 C14.6 3.9, 13.4 5.1, 12.2 5.8 Z' fill='#4bab57' />
    </svg>
  )
}

function BoulderHazardIcon() {
  return (
    <svg className='map-hazard-svg' viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M5 18 L3.5 13 L6.5 7.5 L11 4 L17 5.2 L20.5 9.5 L21 15 L17.2 19.3 L10.5 20.5 Z' fill='#8f99ab' />
      <path d='M9 7 L14.5 6.7 L18 9.6 L17.4 13.8 L13.9 16.7 L9.3 16.2 L7.1 12.6 Z' fill='#a5afbf' opacity='0.68' />
      <circle cx='9' cy='11' r='1.2' fill='#6f798c' />
      <circle cx='14.5' cy='13.5' r='1.1' fill='#6b7486' />
    </svg>
  )
}

function MudHazardIcon() {
  return (
    <svg className='map-hazard-svg' viewBox='0 0 50 20' aria-hidden='true'>
      <ellipse cx='25' cy='12' rx='22' ry='6.8' fill='rgba(78, 56, 36, 0.92)' />
      <ellipse cx='23' cy='11' rx='13' ry='3.7' fill='rgba(108, 80, 53, 0.88)' />
      <ellipse cx='33' cy='13' rx='6.4' ry='2.7' fill='rgba(95, 71, 46, 0.86)' />
    </svg>
  )
}

function RabbitRacerIcon({ accentColor, compact = false }) {
  return (
    <div className={`rabbit-racer ${compact ? 'compact' : ''}`} style={{ '--rabbit-accent': accentColor }} aria-hidden='true'>
      <svg className='rabbit-racer-svg' viewBox='0 0 120 96'>
        <ellipse cx='64' cy='84' rx='38' ry='8' fill='rgba(8, 13, 24, 0.35)' />

        <ellipse cx='44' cy='30' rx='11' ry='25' transform='rotate(-8 44 30)' fill='#ffffff' />
        <ellipse cx='43' cy='30' rx='5' ry='16' transform='rotate(-8 43 30)' fill='#f5d8df' />
        <ellipse cx='68' cy='28' rx='11' ry='27' transform='rotate(8 68 28)' fill='#ffffff' />
        <ellipse cx='68' cy='28' rx='5' ry='17' transform='rotate(8 68 28)' fill='#f5d8df' />

        <ellipse cx='45' cy='68' rx='18' ry='17' fill='#f0f4fb' />
        <ellipse cx='77' cy='67' rx='28' ry='20' fill='#edf2fa' />
        <ellipse cx='82' cy='74' rx='16' ry='14' fill='#eef2f9' />

        <ellipse cx='62' cy='50' rx='33' ry='28' fill='#ffffff' />
        <ellipse cx='89' cy='52' rx='20' ry='19' fill='#f7f9fc' />

        <circle cx='56' cy='47' r='6.5' fill='#35445f' />
        <circle cx='58' cy='45' r='2.3' fill='#f4f8ff' />
        <circle cx='79' cy='49' r='6.2' fill='#364760' />
        <circle cx='81' cy='47' r='2.1' fill='#f4f8ff' />

        <ellipse cx='57' cy='59' rx='4.8' ry='3.5' fill='#f8e2e8' />
        <ellipse cx='75' cy='60' rx='4.6' ry='3.4' fill='#f8e2e8' />

        <path d='M66 57 C68 55, 71 55, 72 57 C71 60, 67 60, 66 57 Z' fill='#f2b6c0' />
        <path d='M69 58 L69 63 M69 63 C66.5 65.5, 63 65.7, 60 63.5 M69 63 C71.5 65.6, 75.5 65.8, 78.5 63.4' stroke='#d38b96' strokeWidth='1.4' strokeLinecap='round' fill='none' />

        <path d='M56 71 L68 73 L56 82 Z' fill='var(--rabbit-accent)' />
        <path d='M81 73 L70 74 L81 83 Z' fill='var(--rabbit-accent)' />
        <circle cx='69' cy='74' r='4.7' fill='#f3edf8' stroke='rgba(92, 108, 146, 0.35)' />
      </svg>
    </div>
  )
}

function HorseRacerIcon({ accentColor, compact = false }) {
  return (
    <div className={`horse-racer ${compact ? 'compact' : ''}`} style={{ '--horse-accent': accentColor }} aria-hidden='true'>
      <svg className='horse-racer-svg' viewBox='0 0 132 98'>
        <ellipse cx='70' cy='86' rx='38' ry='8' fill='rgba(8, 13, 24, 0.34)' />

        <ellipse cx='70' cy='56' rx='32' ry='21' fill='#aa5d3e' />
        <ellipse cx='95' cy='53' rx='22' ry='18' fill='#b96d4d' />
        <ellipse cx='108' cy='53' rx='10' ry='9' fill='#f7f3ed' />
        <ellipse cx='96' cy='51' rx='8' ry='7' fill='#f3ede6' />

        <rect x='47' y='72' width='10' height='16' rx='4' fill='#c1875f' />
        <rect x='64' y='73' width='10' height='15' rx='4' fill='#9f573a' />
        <rect x='84' y='73' width='10' height='15' rx='4' fill='#9f573a' />
        <rect x='100' y='73' width='10' height='15' rx='4' fill='#c1875f' />
        <rect x='46' y='84' width='12' height='6' rx='3' fill='#efe9df' />
        <rect x='63' y='84' width='12' height='6' rx='3' fill='#efe9df' />
        <rect x='83' y='84' width='12' height='6' rx='3' fill='#efe9df' />
        <rect x='99' y='84' width='12' height='6' rx='3' fill='#efe9df' />

        <path d='M40 43 C32 35, 30 28, 29 20 C34 25, 39 31, 44 38' fill='none' stroke='#c5986f' strokeWidth='4' strokeLinecap='round' />
        <path d='M83 30 C86 23, 89 18, 94 14 C94 21, 93 26, 91 31 Z' fill='#d2a57a' />
        <path d='M91 29 C95 22, 99 18, 105 14 C105 20, 104 25, 102 31 Z' fill='#c79567' />
        <path d='M84 32 C88 27, 93 24, 98 23 C95 27, 90 32, 86 35 Z' fill='#b07a54' />

        <ellipse cx='94' cy='31' rx='8' ry='8' fill='#c47a54' />
        <ellipse cx='94' cy='31' rx='4' ry='4' fill='#f7efe6' />
        <circle cx='97' cy='49' r='2.1' fill='#1f1f23' />
        <circle cx='98' cy='48' r='0.8' fill='#f4f4f6' />

        <ellipse cx='80' cy='57' rx='26' ry='14' fill='none' stroke='rgba(58, 33, 24, 0.42)' strokeWidth='6' />
        <path d='M64 46 C72 50, 80 50, 86 45' fill='none' stroke='var(--horse-accent)' strokeWidth='3.4' strokeLinecap='round' />
      </svg>
    </div>
  )
}

function BossCard({ title, boss, countdown, syncNeeded, onFly }) {
  if (!boss || boss.effectiveTime === Number.MAX_SAFE_INTEGER) {
    return (
      <section className='boss-side'>
        <span className='muted'>{title}</span>
        <strong>-</strong>
        <span>--:--:--</span>
      </section>
    )
  }

  return (
    <section className='boss-side'>
      <span className='muted'>{title}</span>
      <strong>{boss.name}</strong>
      {syncNeeded ? <span className='sync-help-text'>싱크를 맞춰주세요</span> : null}
      <span className={syncNeeded ? 'sync-needed-time' : ''}>{countdown}</span>
      {boss.location ? <button className='btn tiny ghost' disabled={!hasMapPoint(boss)} onClick={onFly}>📍 {boss.location}</button> : null}
    </section>
  )
}
