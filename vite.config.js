import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const isDesktop = mode === 'desktop'

  return {
    base: command === 'serve' ? '/' : isDesktop ? './' : '/aion2boss/',
    plugins: [react()],
    build: {
      outDir: isDesktop ? 'dist' : 'docs',
      emptyOutDir: true
    }
  }
})
