import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getDatabase, onValue, ref, remove, update } from 'firebase/database'

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

export default function App() {
  const [roomInput, setRoomInput] = useState('')
  const [roomId, setRoomId] = useState('')
  const [role, setRole] = useState('admin')
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
    window.location.href = window.location.pathname
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
    const handleEscape = (e) => {
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

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [showForm, timeDialog.open, ttsNoticeDialogOpen, syncNoticeDialog.open])

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
            <h1>마족 보스 관리</h1>
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
        <main className='app-shell'>
          <header className='topbar'>
            <div className='room-pill'>ROOM: {roomId} / {role === 'admin' ? '관리자' : '손님'}</div>
            <div className='topbar-actions'>
              <button className='btn ghost' onClick={handleShare}>주소복사</button>
              {role === 'admin' ? <button className='btn danger ghost' onClick={handleLeave}>방 나가기</button> : null}
            </div>
          </header>

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
                              <td key={key} style={{ width: `${columnWidths[key]}px` }}>
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
        </main>
      )}
      {timeDialog.open ? (
        <div className='dialog-backdrop' onClick={closeRemainingDialog}>
          <div className='dialog' onClick={(e) => e.stopPropagation()}>
            <h4>남은 시간 수정</h4>
            <p>시/분/초를 입력하면 [{timeDialog.name || '보스'}]의 다음 젠까지 남은 시간을 바로 반영합니다.</p>
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
              <button className='btn ghost' onClick={closeRemainingDialog}>취소</button>
              <button className='btn primary' onClick={saveRemainingTime}>적용</button>
            </div>
          </div>
        </div>
      ) : null}
      {ttsNoticeDialogOpen ? (
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
      {role === 'admin' && showForm ? (
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
      {syncNoticeDialog.open ? (
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
