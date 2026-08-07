import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import racingBackgroundImage from './assets/racing-background.svg'
import racingDizzyCliffBackgroundImage from './assets/racing-background-dizzy-cliff.svg'
import racingLaneSceneryCliff from './assets/racing-lane-scenery-cliff.svg'
import racingLaneSceneryMeadow from './assets/racing-lane-scenery-meadow.svg'
import racingTrackPatternCliff from './assets/racing-track-pattern-cliff.svg'
import racingTrackPatternMeadow from './assets/racing-track-pattern-meadow.svg'
import { usePersistentBoolean } from './core/usePersistentState'
import {
  BOULDER_STUN_DURATION_MS,
  CARROT_HIT_DISTANCE_PX,
  CARROT_PROJECTILE_DISTANCE_ACCEL_PER_PX_PER_MS,
  CARROT_PROJECTILE_MAX_SPEED_PX_PER_MS,
  CARROT_PROJECTILE_SPEED_PX_PER_MS,
  DEFAULT_RACE_DISTANCE,
  DEFAULT_SKILL_CHANCE_PERCENT,
  DEFAULT_SKILL_TICK_MAX_SEC,
  DEFAULT_SKILL_TICK_MIN_SEC,
  INITIAL_SKILL_OFFSET_MAX_MS,
  LANE_SCENERY_LANE_OFFSET_PERCENT,
  LANE_SCENERY_POSITIONS,
  MAP_DEFAULT,
  MAP_DIZZY_CLIFF,
  MAP_EVENT_TICK_MS,
  MAX_SKILL_TICK_SEC,
  MAX_TRACK_WORLD_WIDTH_PX,
  MIN_SKILL_TICK_SEC,
  MIN_TRACK_WORLD_WIDTH_PX,
  MUD_LIFETIME_MS,
  MUD_SLOW_DURATION_MS,
  PET_TYPE_HORSE,
  PET_TYPE_RABBIT,
  RACER_COLOR_PALETTE,
  RACE_TICK_MS,
  RACING_AUTO_SCROLL_STORAGE_KEY,
  RACING_BGM_BASE_VOLUME,
  RACING_BGM_FADE_MS,
  RACING_BGM_STORAGE_KEY,
  RACING_SFX_STORAGE_KEY,
  RACING_SFX_VOLUME_SCALE,
  RUNNER_EDGE_PADDING_PX,
  RUNNER_MIN_PROGRESS_PERCENT,
  SHIELD_DURATION_MS,
  SOUND_SOURCES,
  STUN_DURATION_MS,
  TRACK_WORLD_PX_PER_DISTANCE
} from './racing/config'

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

export default function RacingGamePage() {
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
  const [bgmEnabled, setBgmEnabled] = usePersistentBoolean(RACING_BGM_STORAGE_KEY, true)
  const [sfxEnabled, setSfxEnabled] = usePersistentBoolean(RACING_SFX_STORAGE_KEY, true)
  const [autoScrollEnabled, setAutoScrollEnabled] = usePersistentBoolean(RACING_AUTO_SCROLL_STORAGE_KEY, true)
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
