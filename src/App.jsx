import { useEffect } from 'react'
import markup from './legacyMarkup.html?raw'
import { initLegacyApp } from './legacyApp'

export default function App() {
  useEffect(() => {
    initLegacyApp()
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: markup }} />
}
