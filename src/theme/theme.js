import { useCallback, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'aion2boss-theme'
const THEME_SYSTEM = 'system'
const THEME_DARK = 'dark'
const THEME_LIGHT = 'light'

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return THEME_DARK
  return window.matchMedia('(prefers-color-scheme: light)').matches ? THEME_LIGHT : THEME_DARK
}

function loadThemePreference() {
  if (typeof window === 'undefined') return THEME_SYSTEM

  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return savedTheme === THEME_DARK || savedTheme === THEME_LIGHT ? savedTheme : THEME_SYSTEM
  } catch {
    return THEME_SYSTEM
  }
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

  const toggleTheme = useCallback(() => {
    setPreference((currentPreference) => {
      const currentTheme = resolveTheme(currentPreference)
      const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK

      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
      } catch {
        // The selected theme still applies for this session when storage is unavailable.
      }

      return nextTheme
    })
  }, [])

  return { theme, toggleTheme }
}
