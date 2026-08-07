import { useCallback, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'aion2boss-theme'
const THEME_SYSTEM = 'system'
const THEME_DARK = 'dark'
const THEME_LIGHT = 'light'
const THEME_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

function isSavedTheme(value) {
  return value === THEME_DARK || value === THEME_LIGHT
}

function loadThemeCookie() {
  if (typeof document === 'undefined') return ''

  const prefix = `${THEME_STORAGE_KEY}=`
  let cookie = ''

  try {
    cookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix)) || ''
  } catch {
    return ''
  }

  if (!cookie) return ''

  try {
    return decodeURIComponent(cookie.slice(prefix.length))
  } catch {
    return ''
  }
}

function saveThemePreference(theme) {
  if (!isSavedTheme(theme) || typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Cookie persistence below remains available when local storage is blocked.
  }

  if (typeof document !== 'undefined') {
    try {
      document.cookie = `${THEME_STORAGE_KEY}=${encodeURIComponent(theme)}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SEC}; SameSite=Lax`
    } catch {
      // Local storage remains the primary persistence mechanism.
    }
  }
}

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return THEME_DARK
  return window.matchMedia('(prefers-color-scheme: light)').matches ? THEME_LIGHT : THEME_DARK
}

function loadThemePreference() {
  if (typeof window === 'undefined') return THEME_SYSTEM

  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isSavedTheme(savedTheme)) return savedTheme
  } catch {
    // Fall through to the cookie backup.
  }

  const cookieTheme = loadThemeCookie()
  return isSavedTheme(cookieTheme) ? cookieTheme : THEME_SYSTEM
}

function resolveTheme(preference) {
  return preference === THEME_SYSTEM ? getSystemTheme() : preference
}

function applyTheme(preference) {
  const resolvedTheme = resolveTheme(preference)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }
  return resolvedTheme
}

const initialThemePreference = loadThemePreference()
applyTheme(initialThemePreference)

export function useTheme() {
  const [preference, setPreference] = useState(initialThemePreference)
  const [theme, setTheme] = useState(() => resolveTheme(initialThemePreference))

  useEffect(() => {
    setTheme(applyTheme(preference))

    if (preference !== THEME_SYSTEM || typeof window === 'undefined' || !window.matchMedia) return undefined

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const handleSystemThemeChange = () => setTheme(applyTheme(THEME_SYSTEM))
    mediaQuery.addEventListener('change', handleSystemThemeChange)
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange)
  }, [preference])

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key !== THEME_STORAGE_KEY || !isSavedTheme(event.newValue)) return
      setPreference(event.newValue)
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const toggleTheme = useCallback(() => {
    setPreference((currentPreference) => {
      const currentTheme = resolveTheme(currentPreference)
      const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK

      saveThemePreference(nextTheme)
      return nextTheme
    })
  }, [])

  return { theme, toggleTheme }
}
