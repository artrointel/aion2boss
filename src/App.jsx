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
  location: '',
  drop: '',
  interval: '',
  mapX: '',
  mapY: ''
}

const pad2 = (num) => String(num).padStart(2, '0')
const TTS_STORAGE_KEY = 'aion2boss_tts_enabled'
const TTS_NOTICE_DISMISS_KEY = 'aion2boss_tts_notice_dismissed'
const ALERT_MARKS = [
  { ms: 62000, text: '1분 남았습니다.' },
  { ms: 32000, text: '30초 남았습니다.' },
  { ms: 12000, text: '10초 남았습니다.' },
  { ms: 7000, text: '5초 남았습니다.' }
]
const CYCLE_DRIFT_CORRECTION_MS = 10000

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
        effectiveTime: spawn.time ?? Number.MAX_SAFE_INTEGER
      }
    })
    .sort((a, b) => a.effectiveTime - b.effectiveTime)
}

function hasMapPoint(boss) {
  return boss?.mapX !== '' && boss?.mapY !== '' && boss?.mapX != null && boss?.mapY != null
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
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [now, setNow] = useState(Date.now())
  const [dragKey, setDragKey] = useState(null)
  const [isMapOpen, setIsMapOpen] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    return window.localStorage.getItem(TTS_STORAGE_KEY) === 'true'
  })
  const [ttsNoticeDialogOpen, setTtsNoticeDialogOpen] = useState(false)
  const [ttsNoticeDontShow, setTtsNoticeDontShow] = useState(() => {
    return window.localStorage.getItem(TTS_NOTICE_DISMISS_KEY) === 'true'
  })
  const [mapAspectRatio, setMapAspectRatio] = useState('16 / 9')
  const [roomDataLoaded, setRoomDataLoaded] = useState(false)
  const [timeDialog, setTimeDialog] = useState({
    open: false,
    key: '',
    name: '',
    h: 0,
    m: 0,
    s: 0
  })
  const [infoDialog, setInfoDialog] = useState({
    open: false,
    name: '',
    content: ''
  })
  const [syncNoticeDialog, setSyncNoticeDialog] = useState({
    open: false,
    bosses: []
  })

  const mapViewportRef = useRef(null)
  const mapImgRef = useRef(null)
  const mapRef = useRef({
    scale: 1,
    x: 0,
    y: 0,
    initialized: false,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0
  })
  const ttsStateRef = useRef({
    cycleId: '',
    prevRemainingMs: null
  })
  const syncNoticeShownRef = useRef(false)
  const syncNoticeCheckedOnEntryRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room) setRoomInput(room)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(TTS_STORAGE_KEY, ttsEnabled ? 'true' : 'false')
    if (!ttsEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [ttsEnabled])

  useEffect(() => {
    window.localStorage.setItem(TTS_NOTICE_DISMISS_KEY, ttsNoticeDontShow ? 'true' : 'false')
  }, [ttsNoticeDontShow])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!roomId) return undefined

    const roomRef = ref(db, `${roomId}/bosses`)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      setBosses(snapshot.val() || {})
      setRoomDataLoaded(true)
    })

    return () => unsubscribe()
  }, [roomId])

  const bossList = useMemo(() => getBossList(bosses, now), [bosses, now])
  const orderedBosses = useMemo(() => {
    return Object.entries(bosses)
      .sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0))
      .map(([key, value]) => ({ key, ...value }))
  }, [bosses])

  const panelBosses = useMemo(() => {
    return bossList.filter((boss) => Number.isFinite(boss.effectiveTime) && boss.effectiveTime < Number.MAX_SAFE_INTEGER)
  }, [bossList])

  const mainBoss = panelBosses[0] ?? null
  const nextBoss = panelBosses.length > 1 ? panelBosses[1] : null
  const prevBoss = panelBosses.length > 1 ? panelBosses[panelBosses.length - 1] : null
  const highlightedRows = useMemo(() => {
    return {
      main: mainBoss?.key ?? '',
      next: nextBoss?.key ?? ''
    }
  }, [mainBoss, nextBoss])
  const syncNeededBosses = useMemo(() => {
    return orderedBosses
      .filter((boss) => isSyncNeeded(boss, now))
      .map((boss) => ({ name: boss.name, color: boss.color || '#ffadad' }))
  }, [orderedBosses, now])
  const mapImageSrc = `${import.meta.env.BASE_URL}aion2boss.png`

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
    if (!ttsEnabled || !mainBoss || mainBoss.effectiveTime === Number.MAX_SAFE_INTEGER) {
      ttsStateRef.current = { cycleId: '', prevRemainingMs: null }
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
      ttsStateRef.current = { cycleId, prevRemainingMs: remainingMs }
      return
    }

    for (const mark of ALERT_MARKS) {
      if (prevState.prevRemainingMs > mark.ms && remainingMs <= mark.ms) {
        if ('speechSynthesis' in window) {
          const utter = new SpeechSynthesisUtterance(mark.text)
          utter.lang = 'ko-KR'
          utter.rate = 1.2
          utter.pitch = 1.25
          utter.volume = 1
          window.speechSynthesis.speak(utter)
        }
      }
    }

    ttsStateRef.current = { cycleId, prevRemainingMs: remainingMs }
  }, [ttsEnabled, mainBoss, now])

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

  const openInfoDialog = (boss) => {
    setInfoDialog({
      open: true,
      name: boss.name || '',
      content: boss.drop || '정보가 없습니다.'
    })
  }

  const closeInfoDialog = () => {
    setInfoDialog({ open: false, name: '', content: '' })
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

    const nextSpawnTimestamp = Date.now() + totalMs
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
      location: form.location.trim(),
      drop: form.drop.trim(),
      interval,
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
        order: Date.now()
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

  const closeSyncNoticeDialog = () => {
    setSyncNoticeDialog({ open: false, bosses: [] })
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
    const sorted = Object.entries(bosses).sort((a, b) => {
      const aTime = getSpawnInfo(a[1], Date.now()).time ?? Number.MAX_SAFE_INTEGER
      const bTime = getSpawnInfo(b[1], Date.now()).time ?? Number.MAX_SAFE_INTEGER
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
      if (infoDialog.open) {
        closeInfoDialog()
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
  }, [showForm, timeDialog.open, infoDialog.open, ttsNoticeDialogOpen, syncNoticeDialog.open])

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
              <h3>보스 현황</h3>
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

            <div className='table-wrap'>
              <table>
                <thead>
                  <tr>
                    <th>보스명</th>
                    <th>위치</th>
                    <th>남은 시간</th>
                    <th>다음 젠 시간</th>
                    {role === 'admin' && showManagePanel ? <th>관리</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {orderedBosses.map((boss) => {
                    const spawn = getSpawnInfo(boss, now)
                    const nextText = spawn.time ? formatDateTime(spawn.time) : '-'
                    const mapReady = hasMapPoint(boss)
                    const syncNeeded = isSyncNeeded(boss, now)

                    const rowClassName = [
                      dragKey === boss.key ? 'dragging' : '',
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
                        <td>
                          <div className='name-cell'>
                            <span style={{ color: boss.color || '#ffadad', fontWeight: 700 }}>{boss.name}</span>
                            <button className='btn-icon-info' onClick={() => openInfoDialog(boss)} aria-label={`${boss.name} 정보 보기`}>i</button>
                          </div>
                        </td>
                        <td>
                          {boss.location || '-'}
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
                        <td>
                          <button
                            className={`btn tiny ghost time-cell-btn ${syncNeeded ? 'sync-needed' : ''}`}
                            disabled={role !== 'admin'}
                            onClick={() => openRemainingDialog(boss)}
                            title={syncNeeded ? '싱크 필요: 남은 시간을 눌러 수정하세요.' : undefined}
                          >
                            {syncNeeded ? '! ' : ''}
                            {renderCountdown({
                              ...boss,
                              effectiveTime: spawn.time ?? Number.MAX_SAFE_INTEGER
                            })}
                          </button>
                        </td>
                        <td>{nextText}</td>
                        {role === 'admin' && showManagePanel ? (
                          <td>
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
          </section>

          {role === 'admin' ? (
            <section className='card controls'>
              <button className='btn' onClick={handleSort}>다음 젠 시간순 정렬</button>
              <button className='btn' disabled={!undoStack.length} onClick={handleUndo}>실행 취소</button>
              <button className='btn' disabled={!redoStack.length} onClick={handleRedo}>다시 실행</button>
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
      {infoDialog.open ? (
        <div className='dialog-backdrop' onClick={closeInfoDialog}>
          <div className='dialog info-dialog' onClick={(e) => e.stopPropagation()}>
            <h4>{infoDialog.name} 정보</h4>
            <pre>{infoDialog.content}</pre>
            <div className='dialog-actions'>
              <button className='btn primary' onClick={closeInfoDialog}>닫기</button>
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
