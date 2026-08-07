import { memo } from 'react'
import {
  MINI_GAME_ITEMS,
  MINI_GAME_TARGET_EXTERNAL,
  getParticipantDisplayName
} from '../core/appCore'

export const MiniGameDialog = memo(function MiniGameDialog({ open, onClose, onSelect }) {
  if (!open) return null

  return (
    <div className='dialog-backdrop' onClick={onClose}>
      <div className='dialog minigame-dialog' onClick={(event) => event.stopPropagation()}>
        <h4>미니게임 선택</h4>
        <p>원하는 미니게임을 선택하세요. 외부 미니게임은 새 탭에서 열립니다.</p>
        <div className='minigame-list'>
          {MINI_GAME_ITEMS.map((miniGame) => (
            <button
              key={miniGame.id}
              type='button'
              className='minigame-item'
              onClick={() => onSelect(miniGame)}
            >
              <span className='minigame-item-head'>
                <strong className='minigame-item-title'>{miniGame.label}</strong>
                <span className={`minigame-item-badge ${miniGame.target}`}>
                  {miniGame.target === MINI_GAME_TARGET_EXTERNAL ? '새 탭' : '현재 탭'}
                </span>
              </span>
              <span className='minigame-item-desc'>{miniGame.description}</span>
            </button>
          ))}
        </div>
        <div className='dialog-actions'>
          <button className='btn ghost' onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
})

export const ParticipantListDialog = memo(function ParticipantListDialog({ entries, myBrowserId, open, onClose }) {
  if (!open) return null

  return (
    <div className='dialog-backdrop' onClick={onClose}>
      <div className='dialog participant-list-dialog' onClick={(event) => event.stopPropagation()}>
        <h4>입장한 사람 목록</h4>
        <p>현재 방에 접속 중인 사람들의 별명입니다.</p>
        {entries.length ? (
          <div className='participant-list'>
            {entries.map((participant) => (
              <div key={participant.id} className='participant-list-item'>
                <span className='participant-list-name'>{getParticipantDisplayName(participant)}</span>
                {participant.id === myBrowserId ? <span className='participant-list-badge'>나</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <p>현재 입장한 사람이 없습니다.</p>
        )}
        <div className='dialog-actions'>
          <button className='btn primary' onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
})

export const TtsNoticeDialog = memo(function TtsNoticeDialog({ dontShowAgain, open, onChangeDontShowAgain, onClose }) {
  if (!open) return null

  return (
    <div className='dialog-backdrop' onClick={onClose}>
      <div className='dialog tts-notice-dialog' onClick={(event) => event.stopPropagation()}>
        <h4>음성 알림 안내</h4>
        <p>PC에서는 브라우저 특성상 음성이 간헐적으로 나오지 않을 수 있습니다. 모바일에서 접속을 추천드려요.</p>
        <label className='dialog-check'>
          <input type='checkbox' checked={dontShowAgain} onChange={(event) => onChangeDontShowAgain(event.target.checked)} />
          다시 알리지 않음
        </label>
        <div className='dialog-actions'>
          <button className='btn primary' onClick={onClose}>확인</button>
        </div>
      </div>
    </div>
  )
})
