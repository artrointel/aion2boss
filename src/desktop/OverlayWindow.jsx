import { useEffect, useRef, useState } from 'react'

const PARTY_OPTIONS = [1, 2, 3, 4]
const BADGE_DRAG_THRESHOLD = 4

function OverlayBossCard({ label, boss, countdown, syncNeeded, loading, onOpenWebApp }) {
  const accent = boss?.color || '#2fb37d'
  const hasBoss = Boolean(boss)
  const locationText = loading
    ? '-'
    : hasBoss
      ? boss.location || (syncNeeded ? '싱크 필요' : '-')
      : '위치 없음'

  return (
    <section
      className={`overlay-boss-card ${syncNeeded ? 'sync-needed' : ''}`}
      style={{ '--overlay-accent': accent }}
      aria-label={`${label} 보스`}
    >
      <div className='overlay-boss-primary'>
        <span className='overlay-boss-label'>{label}</span>
        <strong className='overlay-boss-name'>
          {loading ? '불러오는 중...' : hasBoss ? boss.name : '활성 보스 없음'}
        </strong>
      </div>
      <div className={`overlay-boss-time ${syncNeeded ? 'sync-needed' : ''}`}>
        {syncNeeded ? (
          <button
            type='button'
            className='overlay-sync-alert-btn'
            onClick={onOpenWebApp}
            title='웹 페이지에서 수정하기'
            aria-label='웹 페이지에서 수정하기'
          >
            !
          </button>
        ) : null}
        <span>{loading ? '--:--:--' : countdown}</span>
      </div>
      <span className='overlay-boss-location' title={locationText}>{locationText}</span>
    </section>
  )
}

export default function OverlayWindow({
  roomId,
  roomDataLoaded,
  mainBoss,
  nextBoss,
  mainCountdown,
  nextCountdown,
  mainSyncNeeded,
  nextSyncNeeded,
  opacity,
  scale,
  raceFilter,
  chaseModeEnabled,
  partyFilter,
  editNeedsAttention,
  ttsEnabled,
  alertPrefs,
  alertMarks,
  canCopyBossOrder,
  onOpacityChange,
  onScaleChange,
  onRaceFilterChange,
  onPartyFilterChange,
  onToggleTts,
  onToggleAlertPref,
  onCopyBossOrder,
  onOpenWebApp,
  onExit
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [partyMenuOpen, setPartyMenuOpen] = useState(false)
  const desktopApi = typeof window !== 'undefined' ? window.aion2bossDesktop : null
  const badgeDragStateRef = useRef({
    active: false,
    started: false,
    pointerId: null,
    startScreenX: 0,
    startScreenY: 0
  })
  const suppressBadgeClickRef = useRef(false)
  const loading = !roomDataLoaded && !mainBoss && !nextBoss
  const collapsedBossName = loading ? '불러오는 중...' : mainBoss?.name || '대기 중'
  const collapsedBossCountdown = loading ? '--:--:--' : mainCountdown

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (next) {
        setSettingsOpen(false)
        setPartyMenuOpen(false)
      }
      return next
    })
  }

  const toggleSettingsOpen = () => {
    setSettingsOpen((prev) => {
      const next = !prev
      if (next) setPartyMenuOpen(false)
      return next
    })
  }

  const togglePartyMenuOpen = () => {
    setPartyMenuOpen((prev) => !prev)
  }

  const handlePartyFilterSelect = (value) => {
    onPartyFilterChange(partyFilter === value ? null : value)
    setPartyMenuOpen(false)
  }

  useEffect(() => {
    if (!desktopApi?.beginWindowDrag || !desktopApi?.updateWindowDrag || !desktopApi?.endWindowDrag) {
      return undefined
    }

    const resetBadgeDragState = () => {
      badgeDragStateRef.current = {
        active: false,
        started: false,
        pointerId: null,
        startScreenX: 0,
        startScreenY: 0
      }
    }

    const endBadgeDrag = (pointerId) => {
      const dragState = badgeDragStateRef.current
      if (!dragState.active || dragState.pointerId !== pointerId) return

      if (dragState.started) {
        desktopApi.endWindowDrag().catch(() => {})
      }

      resetBadgeDragState()
    }

    const handlePointerMove = (event) => {
      const dragState = badgeDragStateRef.current
      if (!dragState.active || dragState.pointerId !== event.pointerId) return

      const deltaX = event.screenX - dragState.startScreenX
      const deltaY = event.screenY - dragState.startScreenY
      const dragDistance = Math.hypot(deltaX, deltaY)

      if (!dragState.started && dragDistance >= BADGE_DRAG_THRESHOLD) {
        dragState.started = true
        suppressBadgeClickRef.current = true
        desktopApi.beginWindowDrag({
          x: dragState.startScreenX,
          y: dragState.startScreenY
        }).catch(() => {})
      }

      if (dragState.started) {
        desktopApi.updateWindowDrag({
          x: event.screenX,
          y: event.screenY
        }).catch(() => {})
      }
    }

    const handlePointerUp = (event) => {
      endBadgeDrag(event.pointerId)
    }

    const handlePointerCancel = (event) => {
      endBadgeDrag(event.pointerId)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      desktopApi.endWindowDrag().catch(() => {})
      resetBadgeDragState()
    }
  }, [desktopApi])

  const handleBadgePointerDown = (event) => {
    if (typeof event.button === 'number' && event.button !== 0) return

    suppressBadgeClickRef.current = false

    if (!desktopApi?.beginWindowDrag) return

    badgeDragStateRef.current = {
      active: true,
      started: false,
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY
    }

    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleBadgeClick = () => {
    if (suppressBadgeClickRef.current) {
      suppressBadgeClickRef.current = false
      return
    }

    toggleCollapsed()
  }

  return (
    <div className={`overlay-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <section className='overlay-frame'>
        <header className='overlay-header'>
          <div className='overlay-header-main'>
            <button
              type='button'
              className={`overlay-badge overlay-badge-button ${collapsed ? 'is-collapsed-summary' : ''}`}
              onPointerDown={handleBadgePointerDown}
              onClick={handleBadgeClick}
              title={collapsed ? '오버레이 펼치기' : '오버레이 접기'}
            >
              {collapsed ? (
                <>
                  <span className='overlay-collapsed-name'>{collapsedBossName}</span>
                  <span className='overlay-collapsed-time'>{collapsedBossCountdown}</span>
                </>
              ) : (
                'AION2BOSS'
              )}
            </button>
            {!collapsed ? <strong className='overlay-room-name'>{roomId}</strong> : null}
          </div>
          {!collapsed ? (
            <div className='overlay-header-actions'>
              <button
                type='button'
                className={`overlay-icon-btn ${settingsOpen ? 'active' : ''}`}
                onClick={toggleSettingsOpen}
                title='오버레이 설정'
                aria-label='오버레이 설정'
              >
                ⚙
              </button>
              <button
                type='button'
                className='overlay-icon-btn'
                onClick={onExit}
                title='프로그램 종료'
                aria-label='프로그램 종료'
              >
                🚪
              </button>
            </div>
          ) : null}
        </header>

        {!collapsed && settingsOpen ? (
          <section className='overlay-settings-dialog' role='dialog' aria-label='오버레이 설정'>
            <div className='overlay-settings-section'>
              <div className='overlay-settings-row'>
                <div>
                  <strong className='overlay-settings-title'>오버레이 앱 크기</strong>
                  <p className='overlay-settings-help'>오버레이 전체 UI 크기를 조절합니다.</p>
                </div>
                <span className='overlay-settings-value'>{Math.round(scale * 100)}%</span>
              </div>
              <input
                type='range'
                min='0.5'
                max='1'
                step='0.05'
                value={scale}
                onChange={(event) => onScaleChange(Number(event.target.value))}
              />
            </div>

            <div className='overlay-settings-section'>
              <div className='overlay-settings-row'>
                <div>
                  <strong className='overlay-settings-title'>투명도</strong>
                  <p className='overlay-settings-help'>오버레이 패널의 투명도를 조절합니다.</p>
                </div>
                <span className='overlay-settings-value'>{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type='range'
                min='0.55'
                max='1'
                step='0.05'
                value={opacity}
                onChange={(event) => onOpacityChange(Number(event.target.value))}
              />
            </div>

            <div className='overlay-settings-section'>
              <div className='overlay-settings-row'>
                <div>
                  <strong className='overlay-settings-title'>음성 알림</strong>
                  <p className='overlay-settings-help'>웹 서비스와 동일한 음성 알림 로직을 사용합니다.</p>
                </div>
                <button
                  type='button'
                  className={`overlay-chip ${ttsEnabled ? 'active' : ''}`}
                  onClick={onToggleTts}
                >
                  {ttsEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className='overlay-alert-grid'>
                {alertMarks.map((mark) => (
                  <label key={mark.id} className={`overlay-alert-option ${ttsEnabled ? '' : 'disabled'}`}>
                    <input
                      type='checkbox'
                      checked={alertPrefs[mark.id]}
                      onChange={() => onToggleAlertPref(mark.id)}
                      disabled={!ttsEnabled}
                    />
                    <span>{mark.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {!collapsed && !settingsOpen ? (
          <>
            <div className='overlay-toolbar' role='toolbar' aria-label='오버레이 메뉴'>
              <select
                className='overlay-filter-select'
                value={raceFilter}
                onChange={(event) => onRaceFilterChange(event.target.value)}
                aria-label='종족 필터'
              >
                <option value='모두'>전체</option>
                <option value='천족'>천족</option>
                <option value='마족'>마족</option>
                <option value='기타'>기타</option>
              </select>

              <button
                type='button'
                className='overlay-toolbar-btn'
                onClick={onCopyBossOrder}
                disabled={!canCopyBossOrder}
              >
                순서 복사
              </button>

              {chaseModeEnabled ? (
                <div className='overlay-party-filter'>
                  <button
                    type='button'
                    className={`overlay-toolbar-btn ${partyMenuOpen ? 'active' : ''}`}
                    onClick={togglePartyMenuOpen}
                    aria-haspopup='menu'
                    aria-expanded={partyMenuOpen}
                  >
                    {partyFilter ? `파티 ${partyFilter}` : '파티'}
                  </button>
                  {partyMenuOpen ? (
                    <div className='overlay-party-menu' role='menu' aria-label='파티 선택'>
                      {PARTY_OPTIONS.map((team) => (
                        <button
                          key={team}
                          type='button'
                          className={`overlay-party-option ${partyFilter === team ? 'active' : ''}`}
                          onClick={() => handlePartyFilterSelect(team)}
                        >
                          {team}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type='button'
                className={`overlay-toolbar-btn overlay-edit-btn ${editNeedsAttention ? 'needs-attention' : ''}`}
                onClick={onOpenWebApp}
              >
                웹페이지 열기
              </button>
            </div>

            <div className='overlay-body'>
              <OverlayBossCard
                label='현재'
                boss={mainBoss}
                countdown={mainCountdown}
                syncNeeded={mainSyncNeeded}
                loading={loading}
                onOpenWebApp={onOpenWebApp}
              />
              <OverlayBossCard
                label='다음'
                boss={nextBoss}
                countdown={nextCountdown}
                syncNeeded={nextSyncNeeded}
                loading={loading}
                onOpenWebApp={onOpenWebApp}
              />
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
