const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aion2bossDesktop', {
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('desktop:set-always-on-top', enabled),
  setOpacity: (value) => ipcRenderer.invoke('desktop:set-opacity', value),
  setWindowSize: (size) => ipcRenderer.invoke('desktop:set-window-size', size),
  beginWindowDrag: (point) => ipcRenderer.invoke('desktop:begin-window-drag', point),
  updateWindowDrag: (point) => ipcRenderer.invoke('desktop:update-window-drag', point),
  endWindowDrag: () => ipcRenderer.invoke('desktop:end-window-drag'),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimize-window'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  openExternalUrl: (url) => ipcRenderer.invoke('desktop:open-external-url', url),
  fetchFieldBossPublicCache: (url, timeoutMs) => ipcRenderer.invoke('desktop:fetch-field-boss-public-cache', url, timeoutMs)
})
