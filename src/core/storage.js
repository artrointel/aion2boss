export const ONE_YEAR_SEC = 60 * 60 * 24 * 365

export function readCookie(name, fallback = '') {
  if (typeof document === 'undefined') return fallback

  try {
    const prefix = `${name}=`
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
    return match ? decodeURIComponent(match.slice(prefix.length)) : fallback
  } catch {
    return fallback
  }
}

export function writeCookie(name, value, maxAgeSec = ONE_YEAR_SEC) {
  if (typeof document === 'undefined') return false

  try {
    document.cookie = `${name}=${encodeURIComponent(String(value))}; path=/; max-age=${maxAgeSec}; SameSite=Lax`
    return true
  } catch {
    return false
  }
}

export function readLocalStorage(key, fallback = '') {
  if (typeof window === 'undefined') return fallback

  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function writeLocalStorage(key, value) {
  if (typeof window === 'undefined') return false

  try {
    window.localStorage.setItem(key, String(value))
    return true
  } catch {
    return false
  }
}

export function removeLocalStorage(key) {
  if (typeof window === 'undefined') return false

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function readSessionStorage(key, fallback = '') {
  if (typeof window === 'undefined') return fallback

  try {
    return window.sessionStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function writeSessionStorage(key, value) {
  if (typeof window === 'undefined') return false

  try {
    window.sessionStorage.setItem(key, String(value))
    return true
  } catch {
    return false
  }
}
