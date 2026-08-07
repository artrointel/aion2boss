export const PET_TYPE_RABBIT = 'rabbit'
export const PET_TYPE_HORSE = 'horse'
export const MAP_DEFAULT = 'default'
export const MAP_DIZZY_CLIFF = 'dizzy_cliff'
export const DEFAULT_RACE_DISTANCE = 1000
export const TRACK_WORLD_PX_PER_DISTANCE = 1.55
export const MIN_TRACK_WORLD_WIDTH_PX = 1400
export const MAX_TRACK_WORLD_WIDTH_PX = 9600
export const RACE_TICK_MS = 120
export const INITIAL_SKILL_OFFSET_MAX_MS = 1000
export const MAP_EVENT_TICK_MS = 1000
export const STUN_DURATION_MS = 2000
export const SHIELD_DURATION_MS = 3000
export const BOULDER_STUN_DURATION_MS = 3000
export const MUD_SLOW_DURATION_MS = 3000
export const MUD_LIFETIME_MS = 9000
export const DEFAULT_SKILL_TICK_MIN_SEC = 1
export const DEFAULT_SKILL_TICK_MAX_SEC = 2
export const MIN_SKILL_TICK_SEC = 0.2
export const MAX_SKILL_TICK_SEC = 10
export const DEFAULT_SKILL_CHANCE_PERCENT = {
  attack: 20,
  shield: 10,
  boost: 15,
  boulder: 20,
  mud: 20
}
export const CARROT_PROJECTILE_SPEED_PX_PER_MS = 0.2925
export const CARROT_PROJECTILE_DISTANCE_ACCEL_PER_PX_PER_MS = 0.00045
export const CARROT_PROJECTILE_MAX_SPEED_PX_PER_MS = 1.55
export const CARROT_HIT_DISTANCE_PX = 18
export const RUNNER_EDGE_PADDING_PX = 28
export const RUNNER_MIN_PROGRESS_PERCENT = 3
export const RACING_BGM_STORAGE_KEY = 'aion2boss_racing_bgm_enabled'
export const RACING_SFX_STORAGE_KEY = 'aion2boss_racing_sfx_enabled'
export const RACING_AUTO_SCROLL_STORAGE_KEY = 'aion2boss_racing_auto_scroll_enabled'
export const RACING_BGM_VOLUME_SCALE = 0.5
export const RACING_SFX_VOLUME_SCALE = 0.7
export const RACING_BGM_BASE_VOLUME = 0.36 * RACING_BGM_VOLUME_SCALE
export const RACING_BGM_FADE_MS = 700

const APP_BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

export const SOUND_SOURCES = {
  bgmWaiting: `${APP_BASE_URL}sound/bgm_waiting.mp3`,
  bgmPlaying: `${APP_BASE_URL}sound/bgm_playing.mp3`,
  throwing: `${APP_BASE_URL}sound/throwing.wav`,
  boost: `${APP_BASE_URL}sound/boost.wav`,
  stun: `${APP_BASE_URL}sound/stun.wav`,
  shield: `${APP_BASE_URL}sound/shield.wav`
}

export const LANE_SCENERY_POSITIONS = [4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108]
export const LANE_SCENERY_LANE_OFFSET_PERCENT = 7
export const RACER_COLOR_PALETTE = [
  '#ff8da1',
  '#7fd7ff',
  '#ffd677',
  '#c2b2ff',
  '#81df9c',
  '#b8d6ff',
  '#ffb993',
  '#9dddc1'
]
