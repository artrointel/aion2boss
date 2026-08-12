import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ALERT_ARM_THRESHOLD_MS,
  ALERT_MARKS,
  CHASE_TEAM_OPTIONS,
  COLUMN_LABELS,
  CONFIG,
  COPY_ORDER_WINDOW_MS,
  ADJACENT_BOSS_THRESHOLD_MAX_SEC,
  ADJACENT_BOSS_THRESHOLD_MIN_SEC,
  DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_PASSWORD_CHANGE_KEY,
  DEFAULT_SHARED_MEMO_SIZE,
  EMPTY_CHASE_TEAM_DIALOG,
  EMPTY_PARTICIPANT_LIST_DIALOG,
  EMPTY_ROOM_SETTINGS_DIALOG,
  MINI_GAME_TARGET_INTERNAL,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
  ROOM_CREATION_DISABLED_MESSAGE,
  ROOM_CREATION_ENABLED,
  SHARED_MEMO_MAX_LENGTH,
  SHARED_MEMO_TOOLS,
  TOPBAR_LABEL_MINI_GAME,
  TOPBAR_LABEL_TO_BOSS,
  VIEW_BOSS,
  VIEW_RACING,
  buildChaseCopyText,
  buildParticipantEntriesFromPresence,
  describeChaseTeams,
  diffToClock,
  emptyForm,
  filterBossesByParty,
  filterBossesByRace,
  formatChaseTeams,
  formatDateTime,
  getBossList,
  getChaseRowBackground,
  getChaseTeamEmoji,
  getCopyEligibleBosses,
  getPointerClientX,
  getPresenceBrowserId,
  getPresenceSessionId,
  getSharedMemoPlainText,
  getSpawnInfo,
  hasMapPoint,
  hasRoomPassword,
  hasSharedMemoContent,
  hashRoomPassword,
  isSyncNeeded,
  normalizeAdjacentBossThresholdSec,
  normalizeChaseColumnWidth,
  normalizeChaseTeams,
  normalizeKibeliskValue,
  normalizeParticipantNickname,
  pad2,
  sanitizeSharedMemoHtml
} from './core/appCore'
import {
  getSharedMemoResizeCursor,
  getSharedMemoSizeBounds,
  hasColumnWidthCookie,
  loadAlertPrefsFromCookie,
  loadColumnOrderFromCookie,
  loadColumnPrefsFromCookie,
  loadColumnWidthsFromCookie,
  loadOverlayScale,
  loadParticipantNickname,
  loadRecentRoomEntry,
  loadRaceFilterFromCookie,
  loadSharedMemoSizeFromCookie,
  loadSystemNotificationsEnabled,
  loadTtsEnabledFromCookie,
  loadTtsNoticeDismissed,
  normalizeSharedMemoSize,
  saveAlertPrefsToCookie,
  saveColumnOrderToCookie,
  saveColumnPrefsToCookie,
  saveColumnWidthsToCookie,
  saveOverlayScale,
  saveParticipantNickname,
  saveRecentRoomEntry,
  saveRaceFilterToCookie,
  saveSharedMemoSizeToCookie,
  saveSystemNotificationsEnabled,
  saveTtsEnabledToCookie,
  saveTtsNoticeDismissed
} from './core/browserStorage'
import {
  cancelDisconnect,
  createPresenceSessionRef,
  getRoomSnapshot,
  removeBoss as repoRemoveBoss,
  removeValue,
  scheduleDisconnectRemove,
  setValue,
  subscribeConnectionStatus,
  subscribeRoomBosses,
  subscribeRoomPresence,
  subscribeRoomSettings,
  subscribeServerTimeOffset,
  updateBoss as repoUpdateBoss,
  updateRoot as repoUpdateRoot,
  updateRoomSettings as repoUpdateRoomSettings,
  updateValue
} from './data/roomRepository'
import OverlayWindow from './desktop/OverlayWindow'
import { useTheme } from './theme/theme'
import { MiniGameDialog, ParticipantListDialog, TtsNoticeDialog } from './components/AppDialogs'
import {
  DEFAULT_FIELD_BOSS_SERVER_ID,
  FIELD_BOSS_CACHE_SYNC_INTERVAL_MS,
  FIELD_BOSS_OPTIONS,
  FIELD_BOSS_REGIONS,
  FIELD_BOSS_SERVERS,
  fetchFieldBossPublicCache,
  findFieldBossOption,
  findFieldBossTarget,
  normalizeFieldBossServerId
} from './core/fieldBossCatalog'

const WEB_APP_URL = 'https://artrointel.github.io/aion2boss/'
const MAP_IMAGE_SRC = `${import.meta.env.BASE_URL}aion2boss.png`
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, idx) => idx + 1)
let racingGamePagePromise

function loadRacingGamePage() {
  racingGamePagePromise ||= import('./RacingGamePage')
  return racingGamePagePromise
}

const RacingGamePage = memo(lazy(loadRacingGamePage))

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const overlayMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('overlay') === '1' || params.get('mode') === 'overlay'
  }, [])
  const desktopApi = typeof window !== 'undefined' ? window.aion2bossDesktop : null
  const initialRecentRoomEntryRef = useRef(loadRecentRoomEntry())
  const [roomInput, setRoomInput] = useState(() => initialRecentRoomEntryRef.current.room)
  const [roomPasswordInput, setRoomPasswordInput] = useState(() => initialRecentRoomEntryRef.current.password)
  const [roomPasswordChangeKeyInput, setRoomPasswordChangeKeyInput] = useState(DEFAULT_PASSWORD_CHANGE_KEY)
  const [showRoomPassword, setShowRoomPassword] = useState(false)
  const [loginPending, setLoginPending] = useState(false)
  const [myNickname, setMyNickname] = useState(() => loadParticipantNickname())
  const [participantEntries, setParticipantEntries] = useState([])
  const [roomId, setRoomId] = useState('')
  const [role, setRole] = useState(() => initialRecentRoomEntryRef.current.role)
  const [activeView, setActiveView] = useState(VIEW_BOSS)
  const [miniGameDialogOpen, setMiniGameDialogOpen] = useState(false)
  const [bosses, setBosses] = useState({})
  const [editingKey, setEditingKey] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showManagePanel, setShowManagePanel] = useState(false)
  const [chaseModeEnabled, setChaseModeEnabled] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [raceFilter, setRaceFilter] = useState(() => loadRaceFilterFromCookie())
  const [overlayRaceFilter, setOverlayRaceFilter] = useState('마족')
  const [overlayPartyFilter, setOverlayPartyFilter] = useState(null)
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
  const [sharedMemoOpen, setSharedMemoOpen] = useState(false)
  const [sharedMemoHtml, setSharedMemoHtml] = useState('')
  const [sharedMemoSize, setSharedMemoSize] = useState(() => loadSharedMemoSizeFromCookie())
  const [sharedMemoHasUpdate, setSharedMemoHasUpdate] = useState(false)
  const [sharedMemoUpdateAnimationKey, setSharedMemoUpdateAnimationKey] = useState(0)
  const [sharedMemoResizing, setSharedMemoResizing] = useState('')
  const [sharedMemoSaveStatus, setSharedMemoSaveStatus] = useState('saved')
  const [ttsEnabled, setTtsEnabled] = useState(() => loadTtsEnabledFromCookie())
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(() => loadSystemNotificationsEnabled())
  const [alertPrefs, setAlertPrefs] = useState(() => loadAlertPrefsFromCookie())
  const [ttsNoticeDialogOpen, setTtsNoticeDialogOpen] = useState(false)
  const [ttsNoticeDontShow, setTtsNoticeDontShow] = useState(() => loadTtsNoticeDismissed())
  const [mapAspectRatio, setMapAspectRatio] = useState('16 / 9')
  const [roomDataLoaded, setRoomDataLoaded] = useState(false)
  const [adjacentBossThresholdSec, setAdjacentBossThresholdSec] = useState(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC)
  const [adjacentBossThresholdInput, setAdjacentBossThresholdInput] = useState(String(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC))
  const [autoSortEnabled, setAutoSortEnabled] = useState(false)
  const [fieldBossServerId, setFieldBossServerId] = useState(DEFAULT_FIELD_BOSS_SERVER_ID)
  const [, setFieldBossCache] = useState(null)
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
  const [chaseTeamDialog, setChaseTeamDialog] = useState(EMPTY_CHASE_TEAM_DIALOG)
  const [roomSettingsDialog, setRoomSettingsDialog] = useState(EMPTY_ROOM_SETTINGS_DIALOG)
  const [participantListDialog, setParticipantListDialog] = useState(EMPTY_PARTICIPANT_LIST_DIALOG)
  const [toastMessage, setToastMessage] = useState('')
  const [desktopRuntime, setDesktopRuntime] = useState({
    isElectron: Boolean(desktopApi),
    isDev: false,
    platform: 'web'
  })
  const [desktopOpacity, setDesktopOpacity] = useState(0.94)
  const [desktopScale, setDesktopScale] = useState(() => loadOverlayScale())

  const mapViewportRef = useRef(null)
  const mapImgRef = useRef(null)
  const sharedMemoEditorRef = useRef(null)
  const tableWrapRef = useRef(null)
  const overlayContentRef = useRef(null)
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
  const roleRef = useRef(role)
  const myNicknameRef = useRef(myNickname)
  const sharedMemoLoadedRef = useRef(false)
  const sharedMemoHtmlRef = useRef('')
  const sharedMemoSaveTimerRef = useRef(null)
  const sharedMemoPendingHtmlRef = useRef('')
  const sharedMemoDirtyRef = useRef(false)
  const sharedMemoUpdatedAtRef = useRef(0)
  const sharedMemoResizeRef = useRef({
    direction: '',
    startX: 0,
    startY: 0,
    startWidth: DEFAULT_SHARED_MEMO_SIZE.width,
    startHeight: DEFAULT_SHARED_MEMO_SIZE.height
  })
  const presenceBrowserIdRef = useRef(getPresenceBrowserId())
  const presenceSessionIdRef = useRef(getPresenceSessionId())
  const presenceJoinedAtRef = useRef(Date.now())
  const toastTimerRef = useRef(null)
  const skipTtsDisableCancelRef = useRef(false)

  const getPreferredTtsVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null

    const voices = window.speechSynthesis.getVoices()
    if (!Array.isArray(voices) || !voices.length) return null

    return voices.find((voice) => String(voice?.lang || '').toLowerCase().startsWith('ko'))
      || voices.find((voice) => voice?.default)
      || voices[0]
      || null
  }, [])

  const showSystemNotification = useCallback((text, title = '보스 알림') => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false
    new Notification(title, { body: text, tag: 'aion2boss-boss-alert', renotify: true })
    return true
  }, [])

  const speakTtsMessage = useCallback((text, options = {}) => {
    const {
      fallbackToNotification = false,
      notificationTitle = '보스 알림',
      allowSystemNotification = false
    } = options
    const fallback = () => fallbackToNotification && allowSystemNotification && showSystemNotification(text, notificationTitle)

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return fallback()

    const {
      cancelCurrent = false,
      lang = 'ko-KR',
      rate = 1.2,
      pitch = 1.25,
      volume = 1
    } = options

    if (cancelCurrent) {
      window.speechSynthesis.cancel()
    }

    const utter = new SpeechSynthesisUtterance(text)
    const preferredVoice = getPreferredTtsVoice()
    if (preferredVoice) {
      utter.voice = preferredVoice
    }
    utter.lang = lang
    utter.rate = rate
    utter.pitch = pitch
    utter.volume = volume
    let settled = false
    let startTimer = null
    const finish = (didStart) => {
      if (settled) return
      settled = true
      if (startTimer) window.clearTimeout(startTimer)
      if (!didStart) fallback()
    }
    utter.onstart = () => finish(true)
    utter.onend = () => finish(true)
    utter.onerror = () => finish(false)
    window.speechSynthesis.speak(utter)
    if (fallbackToNotification) {
      startTimer = window.setTimeout(() => {
        if (settled) return
        window.speechSynthesis.cancel()
        finish(false)
      }, 1500)
    }
    return true
  }, [getPreferredTtsVoice, showSystemNotification])

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined

    const primeVoices = () => {
      try {
        window.speechSynthesis.getVoices()
      } catch {
        // Ignore voice enumeration failures and fall back to browser defaults.
      }
    }

    primeVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', primeVoices)

    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', primeVoices)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (!room) return

    setRoomInput(room)
    if (room !== initialRecentRoomEntryRef.current.room) {
      setRoomPasswordInput('')
    }
  }, [])

  useEffect(() => {
    roleRef.current = role
  }, [role])

  useEffect(() => {
    document.body.classList.toggle('overlay-mode', overlayMode)
    return () => document.body.classList.remove('overlay-mode')
  }, [overlayMode])

  useEffect(() => {
    if (!overlayMode || !desktopApi?.getRuntimeInfo) return undefined

    let disposed = false

    desktopApi.getRuntimeInfo()
      .then((info) => {
        if (disposed || !info) return
        setDesktopRuntime({
          isElectron: info.isElectron === true,
          isDev: info.isDev === true,
          platform: info.platform || 'web'
        })
      })
      .catch(() => {})

    desktopApi.setAlwaysOnTop(true).catch(() => {})

    desktopApi.setOpacity(0.94)
      .then((value) => {
        if (!disposed) setDesktopOpacity(Number(value) || 0.94)
      })
      .catch(() => {})

    return () => {
      disposed = true
    }
  }, [desktopApi, overlayMode])

  useLayoutEffect(() => {
    if (!overlayMode || !desktopApi?.setWindowSize) return undefined
    const node = overlayContentRef.current
    if (!node) return undefined

    let rafId = 0

    const syncWindowSize = () => {
      window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect()
        const width = Math.ceil(rect.width || node.scrollWidth || 0)
        const height = Math.ceil(rect.height || node.scrollHeight || 0)
        desktopApi.setWindowSize({ width, height }).catch(() => {})
      })
    }

    syncWindowSize()

    const observer = new ResizeObserver(() => {
      syncWindowSize()
    })
    observer.observe(node)

    window.addEventListener('resize', syncWindowSize)

    return () => {
      window.cancelAnimationFrame(rafId)
      observer.disconnect()
      window.removeEventListener('resize', syncWindowSize)
    }
  }, [desktopApi, desktopScale, overlayMode])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    myNicknameRef.current = myNickname
    saveParticipantNickname(myNickname)
  }, [myNickname])

  useEffect(() => {
    saveTtsEnabledToCookie(ttsEnabled)
    if (!ttsEnabled) {
      if (skipTtsDisableCancelRef.current) {
        skipTtsDisableCancelRef.current = false
        return
      }

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [ttsEnabled])

  useEffect(() => {
    saveTtsNoticeDismissed(ttsNoticeDontShow)
  }, [ttsNoticeDontShow])

  useEffect(() => {
    saveOverlayScale(desktopScale)
  }, [desktopScale])

  useEffect(() => {
    saveSharedMemoSizeToCookie(sharedMemoSize)
  }, [sharedMemoSize])

  useEffect(() => {
    const unsubscribe = subscribeServerTimeOffset((value) => {
      const offset = Number(value)
      setServerOffsetMs(Number.isFinite(offset) ? offset : 0)
    })
    return () => unsubscribe()
  }, [])

  const getServerNow = useCallback(() => Date.now() + serverOffsetMs, [serverOffsetMs])
  const buildRoomUrl = useCallback((nextRoom = '') => {
    const params = new URLSearchParams(window.location.search)
    if (nextRoom) {
      params.set('room', nextRoom)
    } else {
      params.delete('room')
    }
    const query = params.toString()
    return `${window.location.pathname}${query ? `?${query}` : ''}`
  }, [])

  useEffect(() => {
    if (!roomId) return undefined
    const timer = window.setInterval(() => setNow(getServerNow()), 1000)
    setNow(getServerNow())
    return () => window.clearInterval(timer)
  }, [getServerNow, roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const unsubscribe = subscribeRoomBosses(roomId, (value) => {
      setBosses(value || {})
      setRoomDataLoaded(true)
    })

    return () => unsubscribe()
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const unsubscribe = subscribeRoomSettings(roomId, (value) => {
      const settings = value || {}
      const sec = normalizeAdjacentBossThresholdSec(settings.adjacentBossThresholdSec)
      const nextFieldBossServerId = normalizeFieldBossServerId(settings.fieldBossServerId)
      const nextSharedMemoHtml = sanitizeSharedMemoHtml(settings.sharedMemoHtml || '')
      const nextSharedMemoUpdatedAt = Number(settings.sharedMemoUpdatedAt) || 0
      const hadSharedMemoLoaded = sharedMemoLoadedRef.current
      const prevSharedMemoHtml = sharedMemoHtmlRef.current
      const prevSharedMemoUpdatedAt = sharedMemoUpdatedAtRef.current
      const matchesPendingSharedMemo = nextSharedMemoHtml === sharedMemoPendingHtmlRef.current
      const sharedMemoChanged = hadSharedMemoLoaded && nextSharedMemoHtml !== prevSharedMemoHtml
      const sharedMemoUpdated = hadSharedMemoLoaded && nextSharedMemoUpdatedAt !== prevSharedMemoUpdatedAt
      setAdjacentBossThresholdSec(sec)
      setAdjacentBossThresholdInput(String(sec))
      setAutoSortEnabled(settings.autoSortEnabled === true)
      setFieldBossServerId(nextFieldBossServerId)
      setChaseModeEnabled(settings.chaseModeEnabled === true)
      sharedMemoUpdatedAtRef.current = nextSharedMemoUpdatedAt
      if (!sharedMemoDirtyRef.current || matchesPendingSharedMemo) {
        sharedMemoLoadedRef.current = true
        sharedMemoHtmlRef.current = nextSharedMemoHtml
        sharedMemoPendingHtmlRef.current = nextSharedMemoHtml
        setSharedMemoHtml(nextSharedMemoHtml)
      }

      if ((sharedMemoUpdated || (sharedMemoChanged && !matchesPendingSharedMemo)) && hadSharedMemoLoaded) {
        setSharedMemoHasUpdate(true)
        setSharedMemoUpdateAnimationKey((prev) => prev + 1)
      }

      if (matchesPendingSharedMemo || !sharedMemoDirtyRef.current) {
        sharedMemoDirtyRef.current = false
        setSharedMemoSaveStatus('saved')
      }
    })

    return () => unsubscribe()
  }, [roomId])

  useEffect(() => {
    if (!roomId) {
      setParticipantEntries([])
      return undefined
    }

    const unsubscribe = subscribeRoomPresence(roomId, (value) => {
      const entries = buildParticipantEntriesFromPresence(value)

      setParticipantEntries(entries)
    })

    return () => {
      unsubscribe()
      setParticipantEntries([])
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const sessionRef = createPresenceSessionRef(roomId, presenceBrowserIdRef.current, presenceSessionIdRef.current)
    let disposed = false

    const unsubscribe = subscribeConnectionStatus(async (connected) => {
      if (connected !== true) return

      try {
        await scheduleDisconnectRemove(sessionRef)
        if (disposed) return

        await setValue(sessionRef, {
          role: roleRef.current,
          nickname: myNicknameRef.current,
          joinedAt: presenceJoinedAtRef.current,
          updatedAt: Date.now()
        })
      } catch (error) {
        console.error('Failed to sync room presence.', error)
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      cancelDisconnect(sessionRef).catch(() => {})
      removeValue(sessionRef).catch(() => {})
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined

    const sessionRef = createPresenceSessionRef(roomId, presenceBrowserIdRef.current, presenceSessionIdRef.current)
    updateValue(sessionRef, {
      role,
      nickname: myNickname,
      joinedAt: presenceJoinedAtRef.current,
      updatedAt: Date.now()
    }).catch(() => {})

    return undefined
  }, [myNickname, role, roomId])

  const bossList = useMemo(() => getBossList(bosses, now), [bosses, now])
  const participantCount = participantEntries.length
  const enabledBossList = useMemo(() => {
    return bossList.filter((boss) => boss.alertEnabled !== false)
  }, [bossList])
  const filteredBossList = useMemo(() => {
    return filterBossesByRace(enabledBossList, raceFilter)
  }, [enabledBossList, raceFilter])
  const overlayBossList = useMemo(() => {
    return enabledBossList.map((boss) => ({
      ...boss,
      chaseTeams: normalizeChaseTeams(boss.chaseTeams)
    }))
  }, [enabledBossList])
  const overlayFilteredBossList = useMemo(() => {
    return filterBossesByRace(overlayBossList, overlayRaceFilter)
  }, [overlayBossList, overlayRaceFilter])
  const overlayVisibleBossList = useMemo(() => {
    return filterBossesByParty(overlayFilteredBossList, chaseModeEnabled, overlayPartyFilter)
  }, [chaseModeEnabled, overlayFilteredBossList, overlayPartyFilter])
  const orderedBosses = useMemo(() => {
    return Object.entries(bosses)
      .sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0))
      .map(([key, value]) => ({
        key,
        ...value,
        kibelisk: normalizeKibeliskValue(value?.kibelisk),
        alertEnabled: value?.alertEnabled !== false,
        chaseTeams: normalizeChaseTeams(value?.chaseTeams)
      }))
  }, [bosses])
  const overlayFilteredOrderedBosses = useMemo(() => {
    return filterBossesByRace(orderedBosses, overlayRaceFilter)
  }, [orderedBosses, overlayRaceFilter])
  const overlayVisibleOrderedBosses = useMemo(() => {
    return filterBossesByParty(overlayFilteredOrderedBosses, chaseModeEnabled, overlayPartyFilter)
  }, [chaseModeEnabled, overlayFilteredOrderedBosses, overlayPartyFilter])
  const filteredOrderedBosses = useMemo(() => {
    return filterBossesByRace(orderedBosses, raceFilter)
  }, [orderedBosses, raceFilter])
  const copyEligibleFilteredOrderedBosses = useMemo(() => {
    return getCopyEligibleBosses(filteredOrderedBosses, now, COPY_ORDER_WINDOW_MS)
  }, [filteredOrderedBosses, now])
  const overlayCopyEligibleFilteredOrderedBosses = useMemo(() => {
    return getCopyEligibleBosses(overlayVisibleOrderedBosses, now, COPY_ORDER_WINDOW_MS)
  }, [overlayVisibleOrderedBosses, now])
  const formFieldBossOptions = useMemo(() => {
    const regionIndex = Math.trunc(Number(form.regionIndex))
    return Number.isInteger(regionIndex) && regionIndex >= 0
      ? FIELD_BOSS_OPTIONS.filter((option) => option.regionIndex === regionIndex)
      : FIELD_BOSS_OPTIONS
  }, [form.regionIndex])
  const activeFilteredOrderedBossCopyText = useMemo(() => {
    return buildChaseCopyText(copyEligibleFilteredOrderedBosses, (boss) => String(boss.name || '').trim())
  }, [copyEligibleFilteredOrderedBosses])
  const overlayFilteredOrderedBossCopyText = useMemo(() => {
    return buildChaseCopyText(overlayCopyEligibleFilteredOrderedBosses, (boss) => String(boss.name || '').trim())
  }, [overlayCopyEligibleFilteredOrderedBosses])
  const activeFilteredOrderedKibeliskCopyText = useMemo(() => {
    return buildChaseCopyText(copyEligibleFilteredOrderedBosses, (boss) => normalizeKibeliskValue(boss.kibelisk))
  }, [copyEligibleFilteredOrderedBosses])
  const activeBossOrderCopyText = overlayMode ? overlayFilteredOrderedBossCopyText : activeFilteredOrderedBossCopyText
  const canCopyBossOrder = activeBossOrderCopyText.length > 0
  const canCopyKibeliskOrder = activeFilteredOrderedKibeliskCopyText.length > 0
  const enabledAlertMarks = useMemo(() => {
    return ALERT_MARKS.filter((mark) => alertPrefs[mark.id])
  }, [alertPrefs])

  const panelBosses = useMemo(() => {
    return filteredBossList.filter((boss) => Number.isFinite(boss.effectiveTime) && boss.effectiveTime < Number.MAX_SAFE_INTEGER)
  }, [filteredBossList])
  const overlayPanelBosses = useMemo(() => {
    return overlayVisibleBossList.filter((boss) => Number.isFinite(boss.effectiveTime) && boss.effectiveTime < Number.MAX_SAFE_INTEGER)
  }, [overlayVisibleBossList])

  const mainBoss = panelBosses[0] ?? null
  const nextBoss = panelBosses.length > 1 ? panelBosses[1] : null
  const overlayMainBoss = overlayPanelBosses[0] ?? null
  const overlayNextBoss = overlayPanelBosses.length > 1 ? overlayPanelBosses[1] : null
  const activeMainBoss = overlayMode ? overlayMainBoss : mainBoss
  const activeAlertBossList = overlayMode ? overlayVisibleBossList : enabledBossList
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
  const shouldShowColumn = useCallback((key) => {
    if (key === 'chase') return chaseModeEnabled
    if (showManagePanel) return true
    return columnPrefs[key]
  }, [chaseModeEnabled, showManagePanel, columnPrefs])
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
    saveSystemNotificationsEnabled(systemNotificationsEnabled)
  }, [systemNotificationsEnabled])

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
    if (!ttsEnabled || !activeMainBoss || activeMainBoss.effectiveTime === Number.MAX_SAFE_INTEGER || activeMainBoss.alertEnabled === false) {
      ttsStateRef.current = { cycleId: '', prevRemainingMs: null, armed: false }
      return
    }

    const cycleId = `${activeMainBoss.key}:${activeMainBoss.effectiveTime}`
    const remainingMs = activeMainBoss.effectiveTime - now

    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      ttsStateRef.current = { cycleId, prevRemainingMs: remainingMs }
      return
    }

    const prevState = ttsStateRef.current
    if (prevState.cycleId !== cycleId || prevState.prevRemainingMs == null) {
      const smallestEnabledAlertMs = enabledAlertMarks.length
        ? Math.min(...enabledAlertMarks.map((mark) => mark.ms))
        : ALERT_ARM_THRESHOLD_MS
      ttsStateRef.current = {
        cycleId,
        prevRemainingMs: remainingMs,
        armed: remainingMs > smallestEnabledAlertMs
      }
      return
    }

    if (!prevState.armed) {
      ttsStateRef.current = { ...prevState, prevRemainingMs: remainingMs }
      return
    }

    const hasOtherBossInWindow = (windowMs) => {
      return activeAlertBossList.some((boss) => {
        if (boss.key === activeMainBoss.key) return false
        if (!Number.isFinite(boss.effectiveTime) || boss.effectiveTime >= Number.MAX_SAFE_INTEGER) return false
        const bossRemainingMs = boss.effectiveTime - now
        return bossRemainingMs > 0 && bossRemainingMs <= windowMs
      })
    }

    let latestMark = null
    for (const mark of enabledAlertMarks) {
      if (prevState.prevRemainingMs > mark.ms && remainingMs <= mark.ms) {
        if (hasOtherBossInWindow(mark.ms)) {
          continue
        }
        const bossName = activeMainBoss.name || '보스'
        if (!latestMark || mark.ms < latestMark.ms) {
          latestMark = mark
        }
      }
    }

    if (latestMark) {
      const bossName = activeMainBoss.name || '蹂댁뒪'
      speakTtsMessage(`${bossName}, ${latestMark.notice}`, {
        cancelCurrent: true,
        fallbackToNotification: true,
        allowSystemNotification: systemNotificationsEnabled,
        notificationTitle: bossName
      })
    }

    ttsStateRef.current = { ...prevState, prevRemainingMs: remainingMs }
  }, [ttsEnabled, activeMainBoss, now, activeAlertBossList, enabledAlertMarks, speakTtsMessage, systemNotificationsEnabled])

  useEffect(() => {
    if (chaseModeEnabled) return
    setChaseTeamDialog(EMPTY_CHASE_TEAM_DIALOG)
  }, [chaseModeEnabled])

  useEffect(() => {
    if (chaseModeEnabled || overlayPartyFilter == null) return
    setOverlayPartyFilter(null)
  }, [chaseModeEnabled, overlayPartyFilter])

  useEffect(() => {
    if (!chaseModeEnabled) return

    setColumnWidths((prev) => {
      const nextChaseWidth = normalizeChaseColumnWidth(prev.chase)
      if (prev.chase === nextChaseWidth) return prev
      return {
        ...prev,
        chase: nextChaseWidth
      }
    })
  }, [chaseModeEnabled])

  useEffect(() => {
    const editor = sharedMemoEditorRef.current
    if (!sharedMemoOpen || !editor) return

    if (editor.innerHTML !== sharedMemoHtml) {
      editor.innerHTML = sharedMemoHtml
    }
  }, [sharedMemoOpen, sharedMemoHtml])

  useEffect(() => {
    return () => {
      if (sharedMemoSaveTimerRef.current) {
        window.clearTimeout(sharedMemoSaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleWindowResize = () => {
      setSharedMemoSize((prev) => {
        const next = normalizeSharedMemoSize(prev)
        if (next.width === prev.width && next.height === prev.height) {
          return prev
        }
        return next
      })
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    if (!sharedMemoResizing) return undefined

    const cursor = getSharedMemoResizeCursor(sharedMemoResizing)
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'

    const handleMove = (e) => {
      const { direction, startX, startY, startWidth, startHeight } = sharedMemoResizeRef.current
      if (!direction) return
      e.preventDefault()

      const bounds = getSharedMemoSizeBounds()
      const deltaX = startX - e.clientX
      const deltaY = startY - e.clientY
      let nextWidth = startWidth
      let nextHeight = startHeight

      if (direction.includes('left')) {
        nextWidth = startWidth + deltaX
      }
      if (direction.includes('top')) {
        nextHeight = startHeight + deltaY
      }

      setSharedMemoSize({
        width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, Math.round(nextWidth))),
        height: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, Math.round(nextHeight)))
      })
    }

    const handleUp = () => {
      setSharedMemoResizing('')
      sharedMemoResizeRef.current = {
        direction: '',
        startX: 0,
        startY: 0,
        startWidth: DEFAULT_SHARED_MEMO_SIZE.width,
        startHeight: DEFAULT_SHARED_MEMO_SIZE.height
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)

    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [sharedMemoResizing])

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
    return repoUpdateBoss(roomId, key, payload)
  }, [roomId])

  const removeBoss = useCallback((key) => {
    return repoRemoveBoss(roomId, key)
  }, [roomId])

  const saveOrder = useCallback((updates) => {
    return repoUpdateRoot(updates)
  }, [])
  const updateRoot = useCallback((updates) => {
    return repoUpdateRoot(updates)
  }, [])
  const updateRoomSettings = useCallback((payload) => {
    return repoUpdateRoomSettings(roomId, payload)
  }, [roomId])

  const persistAutoSortOrder = useCallback(async (bossSnapshot, nowTs) => {
    if (!roomId || role !== 'admin') return

    const sorted = Object.entries(bossSnapshot || {}).sort((a, b) => {
      const aBoss = a[1]
      const bBoss = b[1]
      const aTime = aBoss?.alertEnabled !== false
        ? (getSpawnInfo(aBoss, nowTs).time ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER
      const bTime = bBoss?.alertEnabled !== false
        ? (getSpawnInfo(bBoss, nowTs).time ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER
      return aTime - bTime || (Number(aBoss?.order) || 0) - (Number(bBoss?.order) || 0)
    })

    const updates = {}
    sorted.forEach(([key, boss], index) => {
      if (Number(boss?.order) !== index) {
        updates[`${roomId}/bosses/${key}/order`] = index
      }
    })

    if (Object.keys(updates).length) {
      await saveOrder(updates)
    }
  }, [role, roomId, saveOrder])

  useEffect(() => {
    if (!autoSortEnabled || role !== 'admin' || !roomId) return
    persistAutoSortOrder(bosses, now).catch((error) => {
      console.warn('Failed to persist automatic boss order.', error)
    })
  }, [autoSortEnabled, bosses, now, persistAutoSortOrder, role, roomId])

  const syncFieldBossCacheToRoom = useCallback(async (serverIdOverride = null) => {
    if (!roomId || role !== 'admin') return

    const cache = await fetchFieldBossPublicCache()
    setFieldBossCache(cache)
    const activeServerId = normalizeFieldBossServerId(serverIdOverride ?? fieldBossServerId)

    const updates = {}
    Object.entries(bosses || {}).forEach(([key, boss]) => {
      if (boss?.manualSpawnOverride === true) return

      const regionIndex = Math.trunc(Number(boss?.regionIndex))
      const bossCode = Math.trunc(Number(boss?.bossCode))
      if (!Number.isInteger(regionIndex) || !Number.isInteger(bossCode)) return
      if (!findFieldBossOption(regionIndex, bossCode)) return

      const targetAt = findFieldBossTarget(cache, activeServerId, regionIndex, bossCode)
      if (!targetAt || Number(boss?.nextSpawnTimestamp) === targetAt) return

      const intervalMs = Number(boss?.interval) > 0 ? Number(boss.interval) * 3600000 : 0
      updates[`${roomId}/bosses/${key}/nextSpawnTimestamp`] = targetAt
      updates[`${roomId}/bosses/${key}/lastKillTimestamp`] = intervalMs ? targetAt - intervalMs : null
      updates[`${roomId}/bosses/${key}/autoFieldBossTargetAt`] = targetAt
      updates[`${roomId}/bosses/${key}/autoFieldBossSyncedAt`] = getServerNow()
    })

    if (Object.keys(updates).length) {
      await updateRoot(updates)
    }
  }, [bosses, fieldBossServerId, getServerNow, role, roomId, updateRoot])

  const queueSharedMemoSave = useCallback((html) => {
    if (!roomId) return

    const sanitized = sanitizeSharedMemoHtml(html)
    sharedMemoHtmlRef.current = sanitized
    sharedMemoPendingHtmlRef.current = sanitized
    sharedMemoDirtyRef.current = true
    setSharedMemoHtml(sanitized)
    setSharedMemoSaveStatus('saving')

    if (sharedMemoSaveTimerRef.current) {
      window.clearTimeout(sharedMemoSaveTimerRef.current)
    }

    sharedMemoSaveTimerRef.current = window.setTimeout(async () => {
      const htmlToSave = sharedMemoPendingHtmlRef.current
      const updatedAt = getServerNow()
      sharedMemoSaveTimerRef.current = null
      try {
        await updateRoomSettings({
          sharedMemoHtml: htmlToSave || null,
          sharedMemoUpdatedAt: updatedAt
        })
        if (sharedMemoPendingHtmlRef.current === htmlToSave) {
          sharedMemoDirtyRef.current = false
          setSharedMemoSaveStatus('saved')
        }
      } catch {
        sharedMemoDirtyRef.current = true
      }
    }, 350)
  }, [getServerNow, roomId, updateRoomSettings])

  useEffect(() => {
    if (!roomId || role !== 'admin') return undefined

    let disposed = false
    const run = () => {
      syncFieldBossCacheToRoom().catch((error) => {
        if (!disposed) console.warn('Failed to sync field boss cache.', error)
      })
    }

    run()
    const timer = window.setInterval(run, FIELD_BOSS_CACHE_SYNC_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [roomId, role, syncFieldBossCacheToRoom])

  const flushSharedMemoSave = useCallback(async () => {
    if (!roomId) return

    const sanitized = sanitizeSharedMemoHtml(sharedMemoEditorRef.current?.innerHTML || sharedMemoPendingHtmlRef.current || '')
    sharedMemoHtmlRef.current = sanitized
    sharedMemoPendingHtmlRef.current = sanitized
    sharedMemoDirtyRef.current = true
    setSharedMemoHtml(sanitized)
    setSharedMemoSaveStatus('saving')

    if (sharedMemoSaveTimerRef.current) {
      window.clearTimeout(sharedMemoSaveTimerRef.current)
      sharedMemoSaveTimerRef.current = null
    }

    try {
      await updateRoomSettings({
        sharedMemoHtml: sanitized || null,
        sharedMemoUpdatedAt: getServerNow()
      })
      if (sharedMemoPendingHtmlRef.current === sanitized) {
        sharedMemoDirtyRef.current = false
        setSharedMemoSaveStatus('saved')
      }
    } catch {
      sharedMemoDirtyRef.current = true
    }
  }, [getServerNow, roomId, updateRoomSettings])

  const handleSharedMemoInput = useCallback(() => {
    const editor = sharedMemoEditorRef.current
    if (!editor) return

    const nextHtml = editor.innerHTML || ''
    if (getSharedMemoPlainText(nextHtml).length > SHARED_MEMO_MAX_LENGTH) {
      editor.innerHTML = sharedMemoHtmlRef.current || ''
      const selection = window.getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      return
    }

    queueSharedMemoSave(nextHtml)
  }, [queueSharedMemoSave])

  const runSharedMemoCommand = useCallback((command) => {
    const editor = sharedMemoEditorRef.current
    if (!editor) return

    editor.focus()
    if (command === 'clearAll') {
      editor.innerHTML = ''
      queueSharedMemoSave('')
      return
    }

    if (typeof document.execCommand === 'function') {
      document.execCommand('styleWithCSS', false, false)
      document.execCommand(command, false, null)
      queueSharedMemoSave(editor.innerHTML || '')
    }
  }, [queueSharedMemoSave])

  const toggleSharedMemo = useCallback(() => {
    if (sharedMemoOpen) {
      setSharedMemoOpen(false)
      return
    }

    setSharedMemoHasUpdate(false)
    setSharedMemoOpen(true)
  }, [sharedMemoOpen])

  const handleSharedMemoResizeStart = useCallback((direction, e) => {
    e.preventDefault()
    sharedMemoResizeRef.current = {
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: sharedMemoSize.width,
      startHeight: sharedMemoSize.height
    }
    setSharedMemoResizing(direction)
  }, [sharedMemoSize.height, sharedMemoSize.width])

  const pushHistory = useCallback((key, data) => {
    setUndoStack((prev) => [...prev, { key, data: { ...data } }])
    setRedoStack([])
  }, [])

  const enterRoom = useCallback((room) => {
    presenceJoinedAtRef.current = Date.now()
    setRoomPasswordInput('')
    setShowRoomPassword(false)
    setParticipantListDialog(EMPTY_PARTICIPANT_LIST_DIALOG)
    setRoomId(room)
    setUndoStack([])
    setRedoStack([])
    setEditingKey(null)
    setShowForm(false)
    setShowManagePanel(false)
    setChaseModeEnabled(false)
    setActiveView(VIEW_BOSS)
    setMiniGameDialogOpen(false)
    setSharedMemoOpen(false)
    setSharedMemoHtml('')
    setSharedMemoHasUpdate(false)
    setSharedMemoUpdateAnimationKey(0)
    setSharedMemoResizing('')
    setSharedMemoSaveStatus('saved')
    setRoomDataLoaded(false)
    setAdjacentBossThresholdSec(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC)
    setAdjacentBossThresholdInput(String(DEFAULT_ADJACENT_BOSS_THRESHOLD_SEC))
    setSyncNoticeDialog({ open: false, bosses: [] })
    setChaseTeamDialog(EMPTY_CHASE_TEAM_DIALOG)
    sharedMemoLoadedRef.current = false
    sharedMemoHtmlRef.current = ''
    sharedMemoPendingHtmlRef.current = ''
    sharedMemoDirtyRef.current = false
    sharedMemoUpdatedAtRef.current = 0
    sharedMemoResizeRef.current = {
      direction: '',
      startX: 0,
      startY: 0,
      startWidth: DEFAULT_SHARED_MEMO_SIZE.width,
      startHeight: DEFAULT_SHARED_MEMO_SIZE.height
    }
    if (sharedMemoSaveTimerRef.current) {
      window.clearTimeout(sharedMemoSaveTimerRef.current)
      sharedMemoSaveTimerRef.current = null
    }
    syncNoticeShownRef.current = false
    syncNoticeCheckedOnEntryRef.current = false

    const newUrl = buildRoomUrl(room)
    window.history.pushState({ path: newUrl }, '', newUrl)
  }, [buildRoomUrl])

  const handleLogin = useCallback(async () => {
    if (loginPending) return

    const room = roomInput.trim()
    if (!room) {
      window.alert('방 이름을 입력해주세요.')
      return
    }

    setLoginPending(true)
    try {
      const roomSnapshot = await getRoomSnapshot(room)
      const roomExists = roomSnapshot.exists()
      const settings = roomSnapshot.child('settings').val() || {}
      const inputPassword = roomPasswordInput.trim()

      if (hasRoomPassword(settings)) {
        if (!inputPassword) {
          window.alert('이 방은 비밀번호가 설정되어 있습니다. 비밀번호를 입력해주세요.')
          return
        }

        const inputPasswordHash = await hashRoomPassword(inputPassword)
        if (inputPasswordHash !== settings.passwordHash) {
          window.alert('비밀번호가 올바르지 않습니다.')
          return
        }
      } else if (!roomExists && role === 'admin' && ROOM_CREATION_ENABLED) {
        const passwordChangeKey = roomPasswordChangeKeyInput.trim() || DEFAULT_PASSWORD_CHANGE_KEY
        const newRoomSettings = {
          passwordChangeKeyHash: await hashRoomPassword(passwordChangeKey),
          passwordChangeKeyUpdatedAt: Date.now()
        }

        if (inputPassword) {
          newRoomSettings.passwordHash = await hashRoomPassword(inputPassword)
          newRoomSettings.passwordUpdatedAt = Date.now()
        }

        await repoUpdateRoomSettings(room, newRoomSettings)

        saveRecentRoomEntry({ room, password: inputPassword, role })
        enterRoom(room)
        return
      }

      if (!roomExists) {
        window.alert(ROOM_CREATION_ENABLED ? '존재하지 않는 방입니다.' : ROOM_CREATION_DISABLED_MESSAGE)
        return
      }

      saveRecentRoomEntry({ room, password: inputPassword, role })
      enterRoom(room)
    } catch (error) {
      console.error('Failed to enter room.', error)
      window.alert('방 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setLoginPending(false)
    }
  }, [enterRoom, loginPending, role, roomInput, roomPasswordChangeKeyInput, roomPasswordInput])

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      window.alert('주소가 복사되었습니다!')
    } catch {
      window.alert('주소 복사에 실패했습니다.')
    }
  }

  const handleNicknameChange = useCallback((e) => {
    setMyNickname(normalizeParticipantNickname(e.target.value))
  }, [])

  const showToast = useCallback((message) => {
    setToastMessage(message)
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('')
      toastTimerRef.current = null
    }, 1600)
  }, [])

  const handleCopyBossOrder = useCallback(async () => {
    if (!activeBossOrderCopyText) return

    try {
      await navigator.clipboard.writeText(activeBossOrderCopyText)
      showToast('복사됨!')
    } catch {
      window.alert('보스 순서 복사에 실패했습니다.')
    }
  }, [activeBossOrderCopyText, showToast])

  const handleCopyKibeliskOrder = useCallback(async () => {
    if (!activeFilteredOrderedKibeliskCopyText) return

    try {
      await navigator.clipboard.writeText(activeFilteredOrderedKibeliskCopyText)
      showToast('복사됨!')
    } catch {
      window.alert('키벨리스크 순서 복사에 실패했습니다.')
    }
  }, [activeFilteredOrderedKibeliskCopyText, showToast])

  const openParticipantListDialog = useCallback(() => {
    setParticipantListDialog({ open: true })
  }, [])

  const closeParticipantListDialog = useCallback(() => {
    setParticipantListDialog(EMPTY_PARTICIPANT_LIST_DIALOG)
  }, [])

  const handleLeave = () => {
    if (!window.confirm('정말 나가시겠습니까?')) return
    setMiniGameDialogOpen(false)
    setActiveView(VIEW_BOSS)
    window.location.href = buildRoomUrl('')
  }

  const handleOverlayExit = useCallback(() => {
    if (desktopApi?.closeWindow) {
      desktopApi.closeWindow()
      return
    }
    window.close()
  }, [desktopApi])

  const handleOverlayOpenWebApp = useCallback(() => {
    const targetUrl = roomId ? `${WEB_APP_URL}?room=${encodeURIComponent(roomId)}` : WEB_APP_URL
    if (desktopApi?.openExternalUrl) {
      desktopApi.openExternalUrl(targetUrl)
      return
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }, [desktopApi, roomId])

  const handleOverlayOpacityChange = useCallback(async (value) => {
    const next = Math.min(1, Math.max(0.55, Number(value) || 0.94))
    if (desktopApi?.setOpacity) {
      const actual = await desktopApi.setOpacity(next)
      setDesktopOpacity(Number(actual) || next)
      return
    }
    setDesktopOpacity(next)
  }, [desktopApi])

  const handleOverlayScaleChange = useCallback((value) => {
    const next = Math.min(1, Math.max(0.5, Number(value) || 1))
    setDesktopScale(next)
  }, [])

  const handleOverlayRaceFilterChange = useCallback((value) => {
    setOverlayRaceFilter(value)
  }, [])

  const handleOverlayPartyFilterChange = useCallback((value) => {
    setOverlayPartyFilter(value)
  }, [])

  const openRoomSettingsDialog = useCallback(() => {
    if (role !== 'admin' || !roomId) return

    setRoomSettingsDialog({
      open: true,
      roomName: roomId,
      passwordChangeKey: '',
      password: '',
      showPassword: false,
      saving: false
    })
  }, [role, roomId])

  const closeRoomSettingsDialog = useCallback(() => {
    setRoomSettingsDialog(EMPTY_ROOM_SETTINGS_DIALOG)
  }, [])

  const saveRoomSettings = useCallback(async () => {
    if (role !== 'admin' || !roomId) return

    const nextRoomName = roomSettingsDialog.roomName.trim()
    const passwordChangeKey = roomSettingsDialog.passwordChangeKey.trim()
    const nextPassword = roomSettingsDialog.password.trim()
    const isRoomNameChanged = nextRoomName !== roomId

    if (!nextRoomName) {
      window.alert('방 이름을 입력해주세요.')
      return
    }

    if (!isRoomNameChanged && !nextPassword) {
      closeRoomSettingsDialog()
      return
    }

    if (nextPassword && !passwordChangeKey) {
      window.alert('비밀번호 변경 키를 입력해주세요.')
      return
    }

    setRoomSettingsDialog((prev) => {
      if (!prev.open) return prev
      return { ...prev, saving: true }
    })

    try {
      const currentRoomSnapshot = await getRoomSnapshot(roomId)
      if (!currentRoomSnapshot.exists()) {
        window.alert('현재 방 정보를 찾지 못했습니다.')
        return
      }

      const currentRoomData = currentRoomSnapshot.val() || {}
      const nextSettings = {
        ...(currentRoomData.settings || {})
      }

      if (nextPassword) {
        const expectedChangeKeyHash = nextSettings.passwordChangeKeyHash
          || await hashRoomPassword(DEFAULT_PASSWORD_CHANGE_KEY)
        const inputChangeKeyHash = await hashRoomPassword(passwordChangeKey)

        if (inputChangeKeyHash !== expectedChangeKeyHash) {
          window.alert('비밀번호 변경 키가 올바르지 않습니다.')
          return
        }

        nextSettings.passwordHash = await hashRoomPassword(nextPassword)
        nextSettings.passwordUpdatedAt = Date.now()
      }

      if (isRoomNameChanged) {
        const targetRoomSnapshot = await getRoomSnapshot(nextRoomName)
        if (targetRoomSnapshot.exists()) {
          window.alert('이미 사용 중인 방 이름입니다. 다른 방 이름을 입력해주세요.')
          return
        }

        const nextRoomData = {
          ...currentRoomData,
          settings: nextSettings
        }

        await updateRoot({
          [roomId]: null,
          [nextRoomName]: nextRoomData
        })

        setBosses(nextRoomData.bosses || {})
        setRoomInput(nextRoomName)
        setRoomId(nextRoomName)
        setRoomDataLoaded(true)

        const nextUrl = buildRoomUrl(nextRoomName)
        window.history.replaceState({ path: nextUrl }, '', nextUrl)
      } else {
        await repoUpdateRoomSettings(roomId, nextSettings)
      }

      const savedRecentRoom = loadRecentRoomEntry()
      const fallbackPassword = savedRecentRoom.room === roomId ? savedRecentRoom.password : ''
      saveRecentRoomEntry({
        room: isRoomNameChanged ? nextRoomName : roomId,
        password: nextPassword || fallbackPassword,
        role
      })

      closeRoomSettingsDialog()
      window.alert(
        isRoomNameChanged && nextPassword
          ? '방 이름과 비밀번호가 변경되었습니다.'
          : isRoomNameChanged
            ? '방 이름이 변경되었습니다.'
            : '비밀번호가 변경되었습니다.'
      )
    } catch (error) {
      console.error('Failed to save room settings.', error)
      window.alert('방 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setRoomSettingsDialog((prev) => {
        if (!prev.open) return prev
        return { ...prev, saving: false }
      })
    }
  }, [buildRoomUrl, closeRoomSettingsDialog, role, roomId, roomSettingsDialog.password, roomSettingsDialog.passwordChangeKey, roomSettingsDialog.roomName, updateRoot])

  const submitRoomSettings = useCallback((e) => {
    e.preventDefault()
    saveRoomSettings()
  }, [saveRoomSettings])

  const openMiniGameDialog = useCallback(() => {
    loadRacingGamePage()
    setMiniGameDialogOpen(true)
  }, [])

  const closeMiniGameDialog = useCallback(() => {
    setMiniGameDialogOpen(false)
  }, [])

  const openRacingView = useCallback(() => {
    setMiniGameDialogOpen(false)
    setShowForm(false)
    setTimeDialog({ open: false, key: '', name: '', h: 0, m: 0, s: 0 })
    setSyncNoticeDialog({ open: false, bosses: [] })
    setActiveView(VIEW_RACING)
  }, [])

  const openBossView = useCallback(() => {
    setMiniGameDialogOpen(false)
    setActiveView(VIEW_BOSS)
  }, [])

  const handleMiniGameSelect = useCallback((miniGame) => {
    if (!miniGame) return

    if (miniGame.target === MINI_GAME_TARGET_INTERNAL) {
      if (miniGame.view === VIEW_RACING) {
        openRacingView()
        return
      }
      if (miniGame.view === VIEW_BOSS) {
        openBossView()
        return
      }
    }

    closeMiniGameDialog()
    const newWindow = window.open('', '_blank')
    if (!newWindow) {
      window.alert('새 탭을 열지 못했습니다. 브라우저 팝업 차단 설정을 확인해주세요.')
      return
    }

    try {
      newWindow.opener = null
      newWindow.location.replace(miniGame.url)
      newWindow.focus()
    } catch {
      newWindow.close()
      window.alert('새 탭을 열지 못했습니다. 브라우저 팝업 차단 설정을 확인해주세요.')
    }
  }, [closeMiniGameDialog, openBossView, openRacingView])

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

  const openChaseTeamDialog = (boss) => {
    if (role !== 'admin' || !chaseModeEnabled) return
    setChaseTeamDialog({
      open: true,
      key: boss.key,
      name: boss.name || '',
      selectedTeams: normalizeChaseTeams(boss.chaseTeams)
    })
  }

  const closeChaseTeamDialog = () => {
    setChaseTeamDialog(EMPTY_CHASE_TEAM_DIALOG)
  }

  const toggleChaseTeamSelection = (teamValue) => {
    setChaseTeamDialog((prev) => {
      if (!prev.open) return prev

      const selectedTeams = prev.selectedTeams.includes(teamValue)
        ? prev.selectedTeams.filter((team) => team !== teamValue)
        : [...prev.selectedTeams, teamValue]

      return {
        ...prev,
        selectedTeams: normalizeChaseTeams(selectedTeams)
      }
    })
  }

  const saveChaseTeams = async () => {
    if (role !== 'admin' || !chaseModeEnabled) return
    const key = chaseTeamDialog.key
    if (!key || !bosses[key]) {
      closeChaseTeamDialog()
      return
    }

    const selectedTeams = normalizeChaseTeams(chaseTeamDialog.selectedTeams)
    await updateBoss(key, {
      chaseTeams: selectedTeams.length ? selectedTeams : null
    })
    closeChaseTeamDialog()
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
      nextSpawnTimestamp,
      manualSpawnOverride: true,
      autoFieldBossTargetAt: null,
      autoFieldBossSyncedAt: null
    })
    closeRemainingDialog()
  }

  const submitRemainingTime = (e) => {
    e.preventDefault()
    saveRemainingTime()
  }

  const submitChaseTeams = (e) => {
    e.preventDefault()
    saveChaseTeams()
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
      kibelisk: normalizeKibeliskValue(boss.kibelisk),
      drop: boss.drop ?? '',
      interval: String(boss.interval ?? ''),
      regionIndex: boss.regionIndex ?? '',
      bossCode: boss.bossCode ?? '',
      mapX: boss.mapX ?? '',
      mapY: boss.mapY ?? ''
    })
    setShowForm(true)
  }

  const handleFormSubmit = async () => {
    const name = form.name.trim()
    const interval = form.interval
    const kibelisk = normalizeKibeliskValue(form.kibelisk)

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
      kibelisk: kibelisk || null,
      drop: form.drop.trim(),
      interval,
      regionIndex: form.regionIndex === '' ? null : Math.trunc(Number(form.regionIndex)),
      bossCode: form.bossCode === '' ? null : Math.trunc(Number(form.bossCode)),
      manualSpawnOverride: editingKey ? bosses[editingKey]?.manualSpawnOverride === true : false,
      alertEnabled: editingKey ? bosses[editingKey]?.alertEnabled !== false : true,
      mapX: form.mapX,
      mapY: form.mapY
    }

    const previousBoss = editingKey ? bosses[editingKey] : null
    const previousRegionIndex = previousBoss?.regionIndex == null ? '' : String(previousBoss.regionIndex)
    const previousBossCode = previousBoss?.bossCode == null ? '' : String(previousBoss.bossCode)
    const nextRegionIndex = payload.regionIndex == null ? '' : String(payload.regionIndex)
    const nextBossCode = payload.bossCode == null ? '' : String(payload.bossCode)
    const fieldBossLinkChanged = previousBoss &&
      (previousRegionIndex !== nextRegionIndex || previousBossCode !== nextBossCode)
    if (!editingKey || fieldBossLinkChanged) {
      payload.manualSpawnOverride = false
      payload.autoFieldBossTargetAt = null
      payload.autoFieldBossSyncedAt = null
    }

    const chaseTeams = editingKey ? normalizeChaseTeams(bosses[editingKey]?.chaseTeams) : []
    if (chaseTeams.length) {
      payload.chaseTeams = chaseTeams
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
      skipTtsDisableCancelRef.current = true
      setTtsEnabled(false)
      speakTtsMessage('음성 알림을 껐습니다', { cancelCurrent: true })
      return
    }

    setTtsEnabled(true)
    speakTtsMessage('음성 알림을 켰습니다', { cancelCurrent: true })
    if (!overlayMode && !ttsNoticeDontShow) {
      setTtsNoticeDialogOpen(true)
    }
  }

  const handleToggleSystemNotifications = async (event) => {
    const enabled = event.target.checked
    if (enabled && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        event.target.checked = false
        return
      }
    }
    setSystemNotificationsEnabled(enabled)
  }

  const closeTtsNoticeDialog = useCallback(() => {
    setTtsNoticeDialogOpen(false)
  }, [])

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

  const saveFieldBossServer = async (event) => {
    const serverId = normalizeFieldBossServerId(event.target.value)
    setFieldBossServerId(serverId)
    if (role !== 'admin' || !roomId) return
    await updateRoomSettings({ fieldBossServerId: serverId })
    syncFieldBossCacheToRoom(serverId).catch((error) => {
      console.warn('Failed to sync field boss cache after server change.', error)
    })
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

  const toggleChaseMode = async () => {
    if (role !== 'admin' || !roomId) return

    if (!chaseModeEnabled) {
      await updateRoomSettings({ chaseModeEnabled: true })
      return
    }

    closeChaseTeamDialog()
    const updates = {
      [`${roomId}/settings/chaseModeEnabled`]: false
    }
    Object.keys(bosses).forEach((key) => {
      updates[`${roomId}/bosses/${key}/chaseTeams`] = null
    })
    await updateRoot(updates)
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
    if (chaseTeamDialog.key === key) {
      closeChaseTeamDialog()
    }
    if (editingKey === key) {
      setShowForm(false)
      resetForm()
    }
  }

  const handleSort = async () => {
    if (role !== 'admin' || !roomId) return
    const nextEnabled = !autoSortEnabled
    await updateRoomSettings({ autoSortEnabled: nextEnabled })
    if (nextEnabled) {
      await persistAutoSortOrder(bosses, getServerNow())
    }
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
  const overlayMainSyncNeeded = overlayMainBoss ? isSyncNeeded(overlayMainBoss, now) : false
  const overlayNextSyncNeeded = overlayNextBoss ? isSyncNeeded(overlayNextBoss, now) : false
  const overlayEditorBosses = useMemo(() => {
    return overlayVisibleOrderedBosses
      .map((boss) => {
        const spawn = getSpawnInfo(boss, now)
        const effectiveTime = spawn.time ?? Number.MAX_SAFE_INTEGER
        const editorBoss = {
          ...boss,
          effectiveTime
        }

        return {
          ...editorBoss,
          countdown: renderCountdown(editorBoss),
          syncNeeded: boss.alertEnabled !== false && isSyncNeeded(boss, now),
          timerEditable: Boolean(boss.interval),
          highlightLabel: boss.key === overlayMainBoss?.key
            ? '현재'
            : boss.key === overlayNextBoss?.key
              ? '다음'
              : ''
        }
      })
      .sort((a, b) => a.effectiveTime - b.effectiveTime)
  }, [overlayVisibleOrderedBosses, now, overlayMainBoss, overlayNextBoss])
  const canEditOverlayBosses = role === 'admin'

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

      if (miniGameDialogOpen) {
        closeMiniGameDialog()
        return
      }
      if (participantListDialog.open) {
        closeParticipantListDialog()
        return
      }
      if (showForm) {
        closeBossFormDialog()
        return
      }
      if (roomSettingsDialog.open) {
        closeRoomSettingsDialog()
        return
      }
      if (chaseTeamDialog.open) {
        closeChaseTeamDialog()
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
    miniGameDialogOpen,
    saveRemainingTime,
    chaseTeamDialog.open,
    closeParticipantListDialog,
    closeRoomSettingsDialog,
    participantListDialog.open,
    showForm,
    roomSettingsDialog.open,
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

  const loginTitle = overlayMode ? '필보 타이머 v1.0' : '필드 보스 타이머'
  const loginDescription = overlayMode
    ? '화면에 필드 보스 타이머를 띄워주는 앱이에요.'
    : '방 이름을 입력하고 역할을 선택하세요.'
  const loginCredit = overlayMode ? '제작자 [브리] 뿌띠' : ''
  const pageClassName = overlayMode ? 'page overlay-page' : 'page'
  const loginWrapClassName = overlayMode ? 'login-wrap overlay-login-wrap' : 'login-wrap'
  const loginCardClassName = overlayMode ? 'login-card overlay-login-card' : 'login-card'
  const overlayPageStyle = overlayMode ? { zoom: desktopScale } : undefined
  const loginView = (
    <section className={loginWrapClassName}>
      <div className={loginCardClassName}>
        <h1>{loginTitle}</h1>
        <p>{loginDescription}</p>
        {loginCredit ? <p className='login-credit'>{loginCredit}</p> : null}

        <div className='login-inputs'>
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder='예: 1서버마족, A공대'
            className='input-text large'
            disabled={loginPending}
          />

          <div className='login-password-field'>
            <input
              type={showRoomPassword ? 'text' : 'password'}
              value={roomPasswordInput}
              onChange={(e) => setRoomPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder={role === 'admin' && ROOM_CREATION_ENABLED
                ? '새 방 비밀번호를 입력하세요'
                : '방 비밀번호가 있으면 입력'
              }
              className='input-text large'
              autoComplete='current-password'
              disabled={loginPending}
            />
            <div className='login-password-actions'>
              <button
                type='button'
                className='btn ghost tiny'
                onClick={() => setShowRoomPassword((prev) => !prev)}
                disabled={loginPending}
              >
                {showRoomPassword ? '숨기기' : '보기'}
              </button>
            </div>
          </div>

          {role === 'admin' && ROOM_CREATION_ENABLED ? (
            <label className='login-create-key-field'>
              <span>비밀번호 변경 키</span>
              <input
                type='password'
                value={roomPasswordChangeKeyInput}
                onChange={(e) => setRoomPasswordChangeKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className='input-text large'
                placeholder='비밀번호 변경 키'
                autoComplete='new-password'
                disabled={loginPending}
              />
            </label>
          ) : null}
        </div>

        <div className='role-switch'>
          <label className={role === 'admin' ? 'active' : ''}>
            <input type='radio' checked={role === 'admin'} onChange={() => setRole('admin')} disabled={loginPending} />
            관리자
          </label>
          <label className={role === 'guest' ? 'active' : ''}>
            <input type='radio' checked={role === 'guest'} onChange={() => setRole('guest')} disabled={loginPending} />
            손님
          </label>
        </div>

        <p className='login-help'>
          {!ROOM_CREATION_ENABLED
            ? ROOM_CREATION_DISABLED_MESSAGE
            : role === 'admin'
            ? '새 방을 만들면 입력한 비밀번호가 저장됩니다. 비워두면 비밀번호 없이 생성됩니다.'
            : '비밀번호가 설정된 방이면 입력 후 입장하세요. 비밀번호가 없는 방은 비워둬도 됩니다.'}
        </p>

        <button className='btn primary block' onClick={handleLogin} disabled={loginPending}>
          {loginPending ? '입장 중...' : overlayMode ? '오버레이 연결' : '입장하기'}
        </button>
        {overlayMode ? (
          <button type='button' className='btn ghost block login-exit-btn' onClick={handleOverlayExit}>
            종료
          </button>
        ) : null}
      </div>
    </section>
  )
  const remainingTimeDialog = activeView === VIEW_BOSS && timeDialog.open ? (
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
  ) : null

  if (overlayMode) {
    return (
      <div className={pageClassName} ref={overlayContentRef} style={overlayPageStyle}>
        {!roomId ? loginView : (
          <OverlayWindow
            roomId={roomId}
            roomDataLoaded={roomDataLoaded}
            mainBoss={overlayMainBoss}
            nextBoss={overlayNextBoss}
            mainCountdown={renderCountdown(overlayMainBoss)}
            nextCountdown={renderCountdown(overlayNextBoss)}
            mainSyncNeeded={overlayMainSyncNeeded}
            nextSyncNeeded={overlayNextSyncNeeded}
            overlayBosses={overlayEditorBosses}
            canEditBosses={canEditOverlayBosses}
            opacity={desktopOpacity}
            scale={desktopScale}
            raceFilter={overlayRaceFilter}
            chaseModeEnabled={chaseModeEnabled}
            partyFilter={overlayPartyFilter}
            editNeedsAttention={overlayMainSyncNeeded || overlayNextSyncNeeded}
            ttsEnabled={ttsEnabled}
            alertPrefs={alertPrefs}
            alertMarks={ALERT_MARKS}
            onOpacityChange={handleOverlayOpacityChange}
            onScaleChange={handleOverlayScaleChange}
            onRaceFilterChange={handleOverlayRaceFilterChange}
            onPartyFilterChange={handleOverlayPartyFilterChange}
            onToggleTts={handleToggleTts}
            onToggleAlertPref={toggleAlertPref}
            onEditBoss={openRemainingDialog}
            onToggleBossAlert={toggleBossAlertEnabled}
            onOpenWebApp={handleOverlayOpenWebApp}
            onExit={handleOverlayExit}
          />
        )}
        {remainingTimeDialog}
      </div>
    )
  }

  return (
    <div className={pageClassName}>
      {!roomId ? loginView : (
        <main className={`app-shell ${activeView === VIEW_RACING ? 'app-shell-racing' : ''}`}>
          <header className='topbar'>
            <div className='topbar-info'>
              <div className='room-pill'>ROOM: {roomId} / {role === 'admin' ? '관리자' : '손님'}</div>
              <button type='button' className='room-pill room-pill-button' onClick={openParticipantListDialog}>
                입장한 인원 수: {participantCount}
              </button>
              <label className='room-pill room-pill-input'>
                <span className='room-pill-label'>내 별명</span>
                <input
                  className='room-pill-text-input'
                  value={myNickname}
                  onChange={handleNicknameChange}
                  placeholder='8글자 이내'
                  maxLength={PARTICIPANT_NICKNAME_MAX_LENGTH}
                />
              </label>
            </div>
            <div className='topbar-actions'>
              <button className='btn ghost' onClick={openMiniGameDialog}>{TOPBAR_LABEL_MINI_GAME}</button>
              {activeView !== VIEW_BOSS ? (
                <button className='btn ghost' onClick={openBossView}>{TOPBAR_LABEL_TO_BOSS}</button>
              ) : null}
              <button className='btn ghost' onClick={handleShare}>주소복사</button>
              <button
                type='button'
                className='btn ghost theme-toggle'
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}
                title={theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}
              >
                <span className='theme-toggle-icon' aria-hidden='true'>{theme === 'dark' ? '☀' : '☾'}</span>
                <span className='theme-toggle-label'>{theme === 'dark' ? '라이트' : '다크'}</span>
              </button>
              {role === 'admin' ? <button className='btn ghost' onClick={openRoomSettingsDialog}>방 설정</button> : null}
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
              <div className='map-action-row'>
                <button className='btn ghost' onClick={() => setIsMapOpen((v) => !v)}>
                  {isMapOpen ? '지도 닫기' : '지도 열기'}
                </button>
                <button className='btn ghost shared-memo-legacy-toggle' onClick={toggleSharedMemo}>
                  {sharedMemoOpen ? '공유메모 닫기' : '공유메모 열기'}
                </button>
              </div>
              {isMapOpen ? (
                <div
                  className='map-viewport'
                  style={{ aspectRatio: mapAspectRatio }}
                  ref={mapViewportRef}
                  onWheel={handleMapWheel}
                  onMouseDown={handleMapMouseDown}
                >
                  <img ref={mapImgRef} src={MAP_IMAGE_SRC} alt='보스 지도' draggable='false' onLoad={handleMapImageLoad} />
                </div>
              ) : null}
            </div>
          </section>

          <div className='shared-memo-floating'>
            {sharedMemoOpen ? (
              <section
                className='shared-memo-card shared-memo-flyout'
                style={{
                  width: `${sharedMemoSize.width}px`,
                  height: `${sharedMemoSize.height}px`
                }}
              >
                <button
                  type='button'
                  className='shared-memo-resize-handle shared-memo-resize-handle-top'
                  aria-label='공유 메모 높이 조절'
                  onPointerDown={(e) => handleSharedMemoResizeStart('top', e)}
                />
                <button
                  type='button'
                  className='shared-memo-resize-handle shared-memo-resize-handle-left'
                  aria-label='공유 메모 너비 조절'
                  onPointerDown={(e) => handleSharedMemoResizeStart('left', e)}
                />
                <button
                  type='button'
                  className='shared-memo-resize-handle shared-memo-resize-handle-corner'
                  aria-label='공유 메모 크기 조절'
                  onPointerDown={(e) => handleSharedMemoResizeStart('top-left', e)}
                />
                <div className='shared-memo-head'>
                  <strong>공유 메모</strong>
                  <span className={`shared-memo-status ${sharedMemoSaveStatus}`}>
                    {sharedMemoSaveStatus === 'saving' ? '자동 저장중..' : '자동 저장됨'}
                  </span>
                </div>
                <div className='shared-memo-toolbar'>
                  {SHARED_MEMO_TOOLS.map((tool) => (
                    <button
                      key={tool.command}
                      type='button'
                      className='shared-memo-tool'
                      title={tool.title}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        runSharedMemoCommand(tool.command)
                      }}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
                <div
                  ref={sharedMemoEditorRef}
                  className='shared-memo-editor'
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder='빠르게 확인할 공유 메모를 적어주세요. (최대 3000자)'
                  role='textbox'
                  aria-label='공유 메모 편집기'
                  aria-multiline='true'
                  onInput={handleSharedMemoInput}
                  onBlur={flushSharedMemoSave}
                />
              </section>
            ) : null}

            <button
              type='button'
              className={`shared-memo-fab ${sharedMemoOpen ? 'active' : ''} ${sharedMemoHasUpdate ? 'has-update' : ''}`}
              style={sharedMemoUpdateAnimationKey > 0
                ? {
                    '--shared-memo-emoji-animation': sharedMemoUpdateAnimationKey % 2 === 0
                      ? 'sharedMemoFabBounceA'
                      : 'sharedMemoFabBounceB'
                  }
                : undefined}
              onClick={toggleSharedMemo}
              aria-label={sharedMemoOpen ? '공유 메모 닫기' : '공유 메모 열기'}
              title={sharedMemoOpen ? '공유 메모 닫기' : '공유 메모 열기'}
            >
              <span aria-hidden='true'>📝</span>
            </button>
          </div>

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
                <button className='btn ghost copy-order-btn' onClick={handleCopyBossOrder} disabled={!canCopyBossOrder}>보스 순서 복사</button>
                <button className='btn ghost copy-order-btn' onClick={handleCopyKibeliskOrder} disabled={!canCopyKibeliskOrder}>키벨리스크 순서 복사</button>
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
                  <button
                    className={`btn ghost chase-toggle-btn ${chaseModeEnabled ? 'active' : ''}`}
                    onClick={toggleChaseMode}
                    title={chaseModeEnabled ? '추격 모드를 종료하고 모든 추격팀을 초기화합니다.' : '공유 추격팀 설정을 시작합니다.'}
                  >
                    {chaseModeEnabled ? '추격 종료' : '추격팀 설정'}
                  </button>
                  <button className='btn ghost' onClick={openCreateForm}>{showForm ? '폼 닫기' : '보스 추가'}</button>
                  <button className='btn ghost' onClick={toggleManagePanel}>{showManagePanel ? '수정 닫기' : '수정'}</button>
                </div>
              ) : null}
            </div>

            {role === 'admin' && showManagePanel ? (
              <div className='column-controls'>
                <section className='pref-group'>
                  <h4 className='pref-group-title'>서버 설정</h4>
                  <div className='pref-row'>
                    <span className='pref-row-label'>필드보스 서버</span>
                    <div className='pref-row-options'>
                      <select className='input-text server-select' value={fieldBossServerId} onChange={saveFieldBossServer}>
                        {FIELD_BOSS_SERVERS.map((server) => (
                          <option key={server.serverId} value={server.serverId}>
                            {server.name} ({server.faction})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
                <section className='pref-group'>
                  <h4 className='pref-group-title'>개인 설정</h4>
                  <div className='pref-row'>
                    <span className='pref-row-label'>📋 정보 표시</span>
                    <div className='pref-row-options'>
                      <label><input type='checkbox' checked={columnPrefs.alert} onChange={() => toggleColumnPref('alert')} /> 알림</label>
                      <label><input type='checkbox' checked={columnPrefs.name} onChange={() => toggleColumnPref('name')} /> 보스명</label>
                      <label><input type='checkbox' checked={columnPrefs.info} onChange={() => toggleColumnPref('info')} /> 정보</label>
                      <label><input type='checkbox' checked={columnPrefs.location} onChange={() => toggleColumnPref('location')} /> 위치</label>
                      <label><input type='checkbox' checked={columnPrefs.kibelisk} onChange={() => toggleColumnPref('kibelisk')} /> 키벨리스크</label>
                      <label><input type='checkbox' checked={columnPrefs.remaining} onChange={() => toggleColumnPref('remaining')} /> 남은 시간</label>
                      <label><input type='checkbox' checked={columnPrefs.next} onChange={() => toggleColumnPref('next')} /> 다음 젠 시간</label>
                    </div>
                  </div>
                  <div className='pref-row'>
                    <span className='pref-row-label'>시스템 알림</span>
                    <div className='pref-row-options'>
                      <label>
                        <input
                          type='checkbox'
                          checked={systemNotificationsEnabled}
                          onChange={handleToggleSystemNotifications}
                        />
                        음성 알림 실패 시 사용
                      </label>
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
                    const autoSynced = Boolean(
                      boss.manualSpawnOverride !== true &&
                      boss.autoFieldBossSyncedAt != null &&
                      Number(boss.autoFieldBossTargetAt) === Number(spawn.time)
                    )
                    const mapReady = hasMapPoint(boss)
                    const syncNeeded = !isTimerExcluded && isSyncNeeded(boss, now)
                    const chaseTeams = normalizeChaseTeams(boss.chaseTeams)
                    const chaseBackground = chaseModeEnabled ? getChaseRowBackground(chaseTeams) : ''
                    const buildCellStyle = (key) => ({
                      width: `${columnWidths[key]}px`,
                      ...(chaseBackground ? { background: chaseBackground } : {})
                    })

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
                              <td key={key} className='alert-cell' style={buildCellStyle(key)}>
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
                              <td key={key} style={buildCellStyle(key)}>
                                <div className='name-cell'>
                                  {nearSpawnBossKeySet.has(boss.key) ? <span className='name-near-icon' title={`스폰 시간이 ${adjacentBossThresholdSec}초 이내로 인접한 보스`}>👉</span> : null}
                                  <span className='boss-name-text' style={{ color: boss.color || '#ffadad' }}>{boss.name}</span>
                                </div>
                              </td>
                            )
                          }
                          if (key === 'info') {
                            return (
                              <td key={key} style={buildCellStyle(key)}>
                                <span className='info-cell-text'>{boss.drop || '-'}</span>
                              </td>
                            )
                          }
                          if (key === 'location') {
                            return (
                              <td key={key} style={buildCellStyle(key)} className='location-cell'>
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
                          if (key === 'kibelisk') {
                            return (
                              <td key={key} style={buildCellStyle(key)}>
                                <span>{boss.kibelisk || '-'}</span>
                              </td>
                            )
                          }
                          if (key === 'remaining') {
                            return (
                              <td key={key} style={buildCellStyle(key)}>
                                <button
                                  className={`btn tiny ghost time-cell-btn ${syncNeeded ? 'sync-needed' : ''} ${autoSynced ? 'auto-synced' : ''}`}
                                  disabled={role !== 'admin' || isTimerExcluded}
                                  onClick={() => !isTimerExcluded && openRemainingDialog(boss)}
                                  title={isTimerExcluded ? '타이머 제외 상태입니다.' : (syncNeeded ? '싱크 필요: 남은 시간을 눌러 수정하세요.' : undefined)}
                                >
                                  {syncNeeded ? '! ' : ''}
                                  {renderCountdown({
                                    ...boss,
                                    effectiveTime: spawn.time ?? Number.MAX_SAFE_INTEGER
                                  })}
                                  {autoSynced ? <span className='auto-sync-check' aria-label='자동갱신 완료' title='자동갱신 완료'> ✓</span> : null}
                                </button>
                              </td>
                            )
                          }
                          if (key === 'next') {
                            return (
                              <td key={key} style={buildCellStyle(key)}>
                                <span className={`next-time-text ${autoSynced ? 'auto-synced' : ''}`}>{nextText}</span>
                              </td>
                            )
                          }
                          if (key === 'chase') {
                            return (
                              <td key={key} style={buildCellStyle(key)} className='chase-cell'>
                                <button
                                  className={`btn tiny ghost chase-cell-btn ${chaseTeams.length ? 'has-selection' : ''}`}
                                  disabled={role !== 'admin'}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => openChaseTeamDialog(boss)}
                                  title={describeChaseTeams(chaseTeams)}
                                  aria-label={`${boss.name} ${describeChaseTeams(chaseTeams)}`}
                                >
                                  {chaseTeams.length ? (
                                    <span className='chase-cell-emoji-group'>
                                      {chaseTeams.map((team) => (
                                        <span key={`${boss.key}-chase-${team}`} className='chase-cell-emoji'>{getChaseTeamEmoji(team)}</span>
                                      ))}
                                    </span>
                                  ) : formatChaseTeams(chaseTeams)}
                                </button>
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
                  <button
                    className={`btn sort-toggle-btn ${autoSortEnabled ? 'active' : ''}`}
                    onClick={handleSort}
                    aria-pressed={autoSortEnabled}
                    title={autoSortEnabled ? '자동 정렬 켜짐' : '자동 정렬 꺼짐'}
                  >
                    다음 젠 시간순 정렬
                  </button>
                  <button className='btn' disabled={!undoStack.length} onClick={handleUndo}>실행 취소</button>
                  <button className='btn' disabled={!redoStack.length} onClick={handleRedo}>다시 실행</button>
                  <span className='creator-credit'>제작자: [브리] 뿌띠</span>
                </section>
              ) : null}
            </>
          ) : (
            <Suspense fallback={null}>
              <RacingGamePage />
            </Suspense>
          )}
        </main>
      )}
      <MiniGameDialog open={miniGameDialogOpen} onClose={closeMiniGameDialog} onSelect={handleMiniGameSelect} />
      <ParticipantListDialog
        entries={participantEntries}
        myBrowserId={presenceBrowserIdRef.current}
        open={participantListDialog.open}
        onClose={closeParticipantListDialog}
      />
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
      {activeView === VIEW_BOSS && chaseTeamDialog.open ? (
        <div className='dialog-backdrop' onClick={closeChaseTeamDialog}>
          <div className='dialog chase-team-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>추격팀 선택</h4>
            <p>[{chaseTeamDialog.name || '보스'}]에 들어갈 추격팀을 골라주세요. 여러 팀을 동시에 선택할 수 있습니다.</p>
            <form onSubmit={submitChaseTeams}>
              <div className='chase-team-grid'>
                {CHASE_TEAM_OPTIONS.map((team) => {
                  const isSelected = chaseTeamDialog.selectedTeams.includes(team.value)
                  return (
                    <button
                      key={team.value}
                      type='button'
                      className={`chase-team-option ${isSelected ? 'active' : ''}`}
                      onClick={() => toggleChaseTeamSelection(team.value)}
                    >
                      <span className='chase-team-option-emoji'>{team.emoji}</span>
                      <span className='chase-team-option-label'>{team.label}</span>
                    </button>
                  )
                })}
              </div>
              <div className='dialog-actions'>
                <button type='button' className='btn ghost' onClick={closeChaseTeamDialog}>취소</button>
                <button type='submit' className='btn primary'>적용</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      <TtsNoticeDialog
        dontShowAgain={ttsNoticeDontShow}
        open={activeView === VIEW_BOSS && ttsNoticeDialogOpen}
        onChangeDontShowAgain={setTtsNoticeDontShow}
        onClose={closeTtsNoticeDialog}
      />
      {role === 'admin' && roomSettingsDialog.open ? (
        <div className='dialog-backdrop' onClick={closeRoomSettingsDialog}>
          <div className='dialog room-settings-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>방 설정</h4>
            <p>방 이름을 바꾸면 공유 링크와 현재 입장 중인 방 이름도 함께 변경됩니다.</p>
            <form className='room-settings-grid' onSubmit={submitRoomSettings}>
              <label className='room-settings-field'>
                <span>방 이름</span>
                <input
                  className='input-text'
                  value={roomSettingsDialog.roomName}
                  onChange={(e) => {
                    const value = e.target.value
                    setRoomSettingsDialog((prev) => ({ ...prev, roomName: value }))
                  }}
                  placeholder='방 이름'
                  disabled={roomSettingsDialog.saving}
                />
              </label>

              <div className='room-settings-field'>
                <label htmlFor='room-password-change-key'>비밀번호 변경 키</label>
                <div className='room-settings-key-row'>
                  <input
                    id='room-password-change-key'
                    type='password'
                    className='input-text'
                    value={roomSettingsDialog.passwordChangeKey}
                    onChange={(e) => {
                      const value = e.target.value
                      setRoomSettingsDialog((prev) => ({ ...prev, passwordChangeKey: value }))
                    }}
                    placeholder='변경 키를 입력하세요'
                    autoComplete='off'
                    disabled={roomSettingsDialog.saving}
                  />
                  <button
                    type='button'
                    className='room-settings-key-help'
                    onClick={() => window.alert('비밀번호 변경 키는 artrointel에게 문의해주세요.')}
                    aria-label='비밀번호 변경 키 도움말'
                    title='비밀번호 변경 키 도움말'
                    disabled={roomSettingsDialog.saving}
                  >
                    ?
                  </button>
                </div>
              </div>

              <label className='room-settings-field'>
                <span>새 비밀번호</span>
                <input
                  type={roomSettingsDialog.showPassword ? 'text' : 'password'}
                  className='input-text'
                  value={roomSettingsDialog.password}
                  onChange={(e) => {
                    const value = e.target.value
                    setRoomSettingsDialog((prev) => ({ ...prev, password: value }))
                  }}
                  placeholder='비워두면 기존 비밀번호 유지'
                  autoComplete='new-password'
                  disabled={roomSettingsDialog.saving || !roomSettingsDialog.passwordChangeKey.trim()}
                />
              </label>

              <div className='room-settings-inline-actions'>
                <button
                  type='button'
                  className='btn ghost tiny'
                  onClick={() => {
                    setRoomSettingsDialog((prev) => ({ ...prev, showPassword: !prev.showPassword }))
                  }}
                  disabled={roomSettingsDialog.saving}
                >
                  {roomSettingsDialog.showPassword ? '숨기기' : '보기'}
                </button>
              </div>

              <div className='dialog-actions'>
                <button type='button' className='btn ghost' onClick={closeRoomSettingsDialog} disabled={roomSettingsDialog.saving}>취소</button>
                <button type='submit' className='btn primary' disabled={roomSettingsDialog.saving}>
                  {roomSettingsDialog.saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {activeView === VIEW_BOSS && role === 'admin' && showForm ? (
        <div className='dialog-backdrop' onClick={closeBossFormDialog}>
          <div className='dialog form-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>{editingKey ? '보스 수정' : '보스 추가'}</h4>
            <div className='form-grid'>
              <label className='form-field form-field-color'>
                <span>색상</span>
                <input type='color' value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
              </label>
              <label className='form-field form-field-name'>
                <span>보스명</span>
                <input className='input-text' placeholder='보스명' value={form.name} maxLength={20} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </label>
              <label className='form-field'>
                <span>종족</span>
                <select className='input-text' value={form.race} onChange={(e) => setForm((p) => ({ ...p, race: e.target.value }))}>
                  <option value='천족'>천족</option>
                  <option value='마족'>마족</option>
                  <option value='기타'>기타</option>
                </select>
              </label>
              <label className='form-field'>
                <span>젠 주기</span>
                <select className='input-text' value={form.interval} onChange={(e) => setForm((p) => ({ ...p, interval: e.target.value }))}>
                  <option value=''>젠 주기</option>
                  {HOUR_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}시간</option>
                  ))}
                </select>
              </label>
              <label className='form-field form-field-location'>
                <span>지역 인덱스</span>
                <select
                  className='input-text'
                  value={form.regionIndex}
                  onChange={(e) => {
                    const regionIndex = e.target.value
                    setForm((p) => ({
                      ...p,
                      regionIndex,
                      bossCode: findFieldBossOption(regionIndex, p.bossCode) ? p.bossCode : ''
                    }))
                  }}
                >
                  <option value=''>자동 갱신 안함</option>
                  {FIELD_BOSS_REGIONS.map((region, index) => (
                    <option key={region.key} value={index}>
                      {index} - {region.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className='form-field form-field-location'>
                <span>보스 몬스터 코드</span>
                <select
                  className='input-text'
                  value={form.bossCode === '' ? '' : `${form.regionIndex}:${form.bossCode}`}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setForm((p) => ({ ...p, bossCode: '' }))
                      return
                    }
                    const [regionIndex, bossCode] = e.target.value.split(':')
                    setForm((p) => ({ ...p, regionIndex, bossCode }))
                  }}
                >
                  <option value=''>보스 선택 안함</option>
                  {formFieldBossOptions.map((boss) => (
                    <option key={`${boss.regionIndex}:${boss.bossCode}`} value={`${boss.regionIndex}:${boss.bossCode}`}>
                      {boss.regionName} / {boss.name} ({boss.bossCode})
                    </option>
                  ))}
                </select>
              </label>
              <label className='form-field form-field-location'>
                <span>위치 정보</span>
                <input className='input-text' placeholder='위치 정보' value={form.location} maxLength={100} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
              </label>
              <label className='form-field'>
                <span>키벨리스크</span>
                <input
                  className='input-text'
                  placeholder='번호'
                  inputMode='numeric'
                  value={form.kibelisk}
                  onChange={(e) => setForm((p) => ({ ...p, kibelisk: normalizeKibeliskValue(e.target.value) }))}
                />
              </label>
              <label className='form-field form-field-map'>
                <span>지도 좌표</span>
                <div className='map-coordinate-fields'>
                  <input className='input-text' aria-label='지도 X' placeholder='X 0.0~1.0' type='number' min='0' max='1' step='0.01' value={form.mapX} onChange={(e) => setForm((p) => ({ ...p, mapX: e.target.value }))} />
                  <input className='input-text' aria-label='지도 Y' placeholder='Y 0.0~1.0' type='number' min='0' max='1' step='0.01' value={form.mapY} onChange={(e) => setForm((p) => ({ ...p, mapY: e.target.value }))} />
                </div>
              </label>
              <label className='form-field form-field-info'>
                <span>정보 내용</span>
                <textarea
                  className='input-text textarea'
                  placeholder='여러 줄 입력 가능'
                  value={form.drop}
                  maxLength={400}
                  rows={4}
                  onChange={(e) => setForm((p) => ({ ...p, drop: e.target.value }))}
                />
              </label>
              <div className='row-actions'>
                {editingKey ? <button type='button' className='btn danger' onClick={() => handleDelete(editingKey)}>삭제</button> : null}
                <button type='button' className='btn ghost' onClick={closeBossFormDialog}>취소</button>
                <button type='button' className='btn primary' onClick={handleFormSubmit}>{editingKey ? '수정 저장' : '등록'}</button>
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
                  <span className='boss-color-text' style={{ color: boss.color, fontWeight: 700 }}>{boss.name}</span>
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
      {toastMessage ? (
        <div className='app-toast' role='status' aria-live='polite'>
          {toastMessage}
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
