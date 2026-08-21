import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const isDesktop = mode === 'desktop'

  return {
    base: command === 'serve' ? '/' : isDesktop ? './' : '/aion2boss/',
    plugins: [react()],
    server: {
      proxy: {
        '/api/notmeter-field-boss-public': {
          target: 'https://notmeter.112-168-140-142.sslip.io',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/field-boss/v1/public'
        }
      }
    },
    build: {
      outDir: isDesktop ? 'dist' : 'docs',
      emptyOutDir: true
    }
  }
})
