import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, shell } from 'electron'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rendererDistPath = path.join(__dirname, '..', 'dist')
const preloadPath = path.join(__dirname, 'preload.cjs')
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const defaultOverlayOpacity = 0.94
const MIN_OVERLAY_SIZE = {
  width: 120,
  height: 48
}
const OVERLAY_LOGIN_SIZE = {
  width: 460,
  height: 430
}
const OVERLAY_ACTIVE_SIZE = {
  width: 460,
  height: 250
}

let mainWindow = null
const windowDragState = new Map()

function applyOverlayState(win, enabled) {
  if (!win || win.isDestroyed()) return

  win.setAlwaysOnTop(enabled, enabled ? 'screen-saver' : 'normal')
  win.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: true })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: OVERLAY_LOGIN_SIZE.width,
    height: OVERLAY_LOGIN_SIZE.height,
    minWidth: MIN_OVERLAY_SIZE.width,
    minHeight: MIN_OVERLAY_SIZE.height,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    hasShadow: false,
    title: 'AION2 Boss Overlay',
    resizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  applyOverlayState(win, true)
  win.setOpacity(defaultOverlayOpacity)

  if (devServerUrl) {
    win.loadURL(`${devServerUrl}?overlay=1`)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(rendererDistPath, 'index.html'), {
      query: {
        overlay: '1'
      }
    })
  }

  return win
}

function setWindowSize(win, size) {
  if (!win || win.isDestroyed()) return null

  const width = Math.max(MIN_OVERLAY_SIZE.width, Math.round(Number(size?.width) || OVERLAY_ACTIVE_SIZE.width))
  const height = Math.max(MIN_OVERLAY_SIZE.height, Math.round(Number(size?.height) || OVERLAY_ACTIVE_SIZE.height))
  win.setContentSize(width, height)
  return { width, height }
}

ipcMain.handle('desktop:get-runtime-info', () => ({
  isElectron: true,
  isDev: Boolean(devServerUrl),
  platform: process.platform
}))

ipcMain.handle('desktop:set-always-on-top', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  applyOverlayState(win, true)
  return win.isAlwaysOnTop()
})

ipcMain.handle('desktop:set-opacity', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return 1

  const nextOpacity = Math.min(1, Math.max(0.2, Number(value) || 1))
  win.setOpacity(nextOpacity)
  return nextOpacity
})

ipcMain.handle('desktop:begin-window-drag', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return false

  const screenX = Math.round(Number(point?.x))
  const screenY = Math.round(Number(point?.y))
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false

  const [winX, winY] = win.getPosition()
  windowDragState.set(event.sender.id, {
    offsetX: screenX - winX,
    offsetY: screenY - winY
  })
  return true
})

ipcMain.handle('desktop:update-window-drag', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return false

  const dragState = windowDragState.get(event.sender.id)
  if (!dragState) return false

  const screenX = Math.round(Number(point?.x))
  const screenY = Math.round(Number(point?.y))
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false

  win.setPosition(screenX - dragState.offsetX, screenY - dragState.offsetY)
  return true
})

ipcMain.handle('desktop:end-window-drag', (event) => {
  windowDragState.delete(event.sender.id)
  return true
})

ipcMain.handle('desktop:minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  win.minimize()
  return true
})

ipcMain.handle('desktop:close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  windowDragState.delete(event.sender.id)
  win.close()
  return true
})

ipcMain.handle('desktop:open-external-url', async (_event, url) => {
  const targetUrl = String(url || '').trim()
  if (!targetUrl) return false

  try {
    await shell.openExternal(targetUrl)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('desktop:set-window-size', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return setWindowSize(win, size)
})

app.whenReady().then(() => {
  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
