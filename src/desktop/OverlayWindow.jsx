import { useEffect, useRef, useState } from 'react'

const PARTY_OPTIONS = [1, 2, 3, 4]
const BADGE_DRAG_THRESHOLD = 4
const EDIT_CONTEXT_MENU_WIDTH = 154
const EDIT_CONTEXT_MENU_HEIGHT = 52
const EDIT_CONTEXT_MENU_MARGIN = 8

function OverlayBossCard({ label, boss, countdown, syncNeeded, loading }) {
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
          <span className='overlay-sync-indicator' aria-hidden='true'>
            !
          </span>
        ) : null}
        <span>{loading ? '--:--:--' : countdown}</span>
      </div>
      <span className='overlay-boss-location' title={locationText}>{locationText}</span>
    </section>
  )
}

function OverlayEditRow({ boss, countdown, syncNeeded, highlightLabel, canEdit, editTitle, onEdit, onContextMenu }) {
  const accent = boss?.color || '#2fb37d'
  const locationText = boss?.location || '-'

  const handleEdit = () => {
    if (!canEdit) return
    onEdit(boss)
  }

  return (
    <section
      className={`overlay-edit-row ${syncNeeded ? 'sync-needed' : ''} ${boss.alertEnabled === false ? 'alert-disabled' : ''}`}
      style={{ '--overlay-accent': accent }}
      onContextMenu={(event) => onContextMenu(event, boss)}
    >
      <div className='overlay-edit-main'>
        <div className='overlay-edit-head'>
          {highlightLabel ? <span className='overlay-edit-kind'>{highlightLabel}</span> : null}
          <strong className='overlay-edit-name'>{boss.name || '이름 없음'}</strong>
        </div>
        <span className='overlay-edit-location' title={locationText}>{locationText}</span>
      </div>
      <button
        type='button'
        className={`overlay-edit-time-btn ${syncNeeded ? 'sync-needed' : ''}`}
        disabled={!canEdit}
        onClick={handleEdit}
        title={editTitle}
      >
        {syncNeeded ? <span className='overlay-edit-alert'>!</span> : null}
        <span>{countdown}</span>
      </button>
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
  overlayBosses,
  canEditBosses,
  opacity,
  scale,
  raceFilter,
  chaseModeEnabled,
  partyFilter,
  editNeedsAttention,
  ttsEnabled,
  alertPrefs,
  alertMarks,
  onOpacityChange,
  onScaleChange,
  onRaceFilterChange,
  onPartyFilterChange,
  onToggleTts,
  onToggleAlertPref,
  onEditBoss,
  onToggleBossAlert,
  onOpenWebApp,
  onExit
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [partyMenuOpen, setPartyMenuOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContextMenu, setEditContextMenu] = useState(null)
  const desktopApi = typeof window !== 'undefined' ? window.aion2bossDesktop : null
  const badgeDragStateRef = useRef({
    active: false,
    started: false,
    pointerId: null,
    startScreenX: 0,
    startScreenY: 0
  })
  const suppressBadgeClickRef = useRef(false)
  const loading = !roomDataLoaded && !mainBoss && !nextBoss && overlayBosses.length === 0
  const collapsedBossName = loading ? '불러오는 중...' : mainBoss?.name || '대기 중'
  const collapsedBossCountdown = loading ? '--:--:--' : mainCountdown

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (next) {
        setSettingsOpen(false)
        setPartyMenuOpen(false)
        setEditContextMenu(null)
      }
      return next
    })
  }

  const toggleSettingsOpen = () => {
    setSettingsOpen((prev) => {
      const next = !prev
      if (next) {
        setPartyMenuOpen(false)
        setEditContextMenu(null)
      }
      return next
    })
  }

  const togglePartyMenuOpen = () => {
    setEditContextMenu(null)
    setPartyMenuOpen((prev) => !prev)
  }

  const toggleEditMode = () => {
    setEditMode((prev) => {
      const next = !prev
      if (next) {
        setSettingsOpen(false)
        setPartyMenuOpen(false)
      } else {
        setEditContextMenu(null)
      }
      return next
    })
  }

  const handlePartyFilterSelect = (value) => {
    onPartyFilterChange(partyFilter === value ? null : value)
    setPartyMenuOpen(false)
    setEditContextMenu(null)
  }

  const closeEditContextMenu = () => {
    setEditContextMenu(null)
  }

  const handleEditRowContextMenu = (event, boss) => {
    event.preventDefault()
    event.stopPropagation()

    const maxX = Math.max(EDIT_CONTEXT_MENU_MARGIN, window.innerWidth - EDIT_CONTEXT_MENU_WIDTH - EDIT_CONTEXT_MENU_MARGIN)
    const maxY = Math.max(EDIT_CONTEXT_MENU_MARGIN, window.innerHeight - EDIT_CONTEXT_MENU_HEIGHT - EDIT_CONTEXT_MENU_MARGIN)

    setEditContextMenu({
      boss,
      x: Math.max(EDIT_CONTEXT_MENU_MARGIN, Math.min(event.clientX, maxX)),
      y: Math.max(EDIT_CONTEXT_MENU_MARGIN, Math.min(event.clientY, maxY))
    })
  }

  const handleToggleBossAlertFromMenu = async () => {
    if (!editContextMenu?.boss || !onToggleBossAlert) return
    await onToggleBossAlert(editContextMenu.boss)
    closeEditContextMenu()
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

  useEffect(() => {
    if (!editContextMenu) return undefined

    const handlePointerDown = (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.overlay-edit-context-menu')) return
      closeEditContextMenu()
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeEditContextMenu()
      }
    }

    const handleCloseRequest = () => {
      closeEditContextMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('wheel', handleCloseRequest, { passive: true })
    window.addEventListener('scroll', handleCloseRequest, true)
    window.addEventListener('blur', handleCloseRequest)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('wheel', handleCloseRequest)
      window.removeEventListener('scroll', handleCloseRequest, true)
      window.removeEventListener('blur', handleCloseRequest)
    }
  }, [editContextMenu])

  useEffect(() => {
    if (!collapsed && !settingsOpen && editMode) return
    closeEditContextMenu()
  }, [collapsed, editMode, settingsOpen])

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
                onClick={onOpenWebApp}
                title='웹페이지 열기'
                aria-label='웹페이지 열기'
              >
                🌐
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
                className={`overlay-toolbar-btn overlay-edit-btn ${editMode ? 'active' : ''} ${editNeedsAttention ? 'needs-attention' : ''}`}
                onClick={toggleEditMode}
              >
                {editMode ? '완료' : '수정'}
              </button>
            </div>

            {editMode ? (
              <div className='overlay-edit-list'>
                {loading ? (
                  <section className='overlay-edit-empty'>불러오는 중...</section>
                ) : overlayBosses.length ? (
                  overlayBosses.map((boss) => (
                    <OverlayEditRow
                      key={boss.key}
                      boss={boss}
                      countdown={boss.countdown}
                      syncNeeded={boss.syncNeeded}
                      highlightLabel={boss.highlightLabel}
                      canEdit={canEditBosses && boss.timerEditable}
                      editTitle={
                        canEditBosses
                          ? (boss.timerEditable ? '남은 시간 수정' : '주기가 없는 보스는 수정할 수 없습니다.')
                          : '관리자만 수정할 수 있습니다.'
                      }
                      onEdit={onEditBoss}
                      onContextMenu={handleEditRowContextMenu}
                    />
                  ))
                ) : (
                  <section className='overlay-edit-empty'>필터에 맞는 보스가 없습니다.</section>
                )}
              </div>
            ) : (
              <div className='overlay-body'>
                <OverlayBossCard
                  label='현재'
                  boss={mainBoss}
                  countdown={mainCountdown}
                  syncNeeded={mainSyncNeeded}
                  loading={loading}
                />
                <OverlayBossCard
                  label='다음'
                  boss={nextBoss}
                  countdown={nextCountdown}
                  syncNeeded={nextSyncNeeded}
                  loading={loading}
                />
              </div>
            )}
          </>
        ) : null}
        {editContextMenu ? (
          <div
            className='overlay-edit-context-menu'
            role='menu'
            aria-label='보스 카드 메뉴'
            style={{ left: `${editContextMenu.x}px`, top: `${editContextMenu.y}px` }}
          >
            <button
              type='button'
              className={`overlay-edit-context-item ${editContextMenu.boss?.alertEnabled === false ? 'active' : ''}`}
              onClick={handleToggleBossAlertFromMenu}
              disabled={!canEditBosses}
              role='menuitemcheckbox'
              aria-checked={editContextMenu.boss?.alertEnabled === false}
            >
              <span className='overlay-edit-context-check' aria-hidden='true'>
                {editContextMenu.boss?.alertEnabled === false ? '✓' : ''}
              </span>
              <span>알림 제외</span>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
