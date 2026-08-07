import { useEffect, useState } from 'react'
import { readLocalStorage, writeLocalStorage } from './storage'

export function usePersistentBoolean(storageKey, defaultValue = false) {
  const [value, setValue] = useState(() => {
    const fallback = defaultValue ? 'true' : 'false'
    return readLocalStorage(storageKey, fallback) !== 'false'
  })

  useEffect(() => {
    writeLocalStorage(storageKey, value ? 'true' : 'false')
  }, [storageKey, value])

  return [value, setValue]
}
