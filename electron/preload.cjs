'use strict'
// Chay's Photo Studio — Electron preload (context isolation ON).
// Exposes one minimal, audited surface to the web app.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chaysPhotoStudio', {
  isElectron: true,
  platform: process.platform,
  /** Subscribe to image files launched from the OS. cb({name, type, data}). Returns unsubscribe. */
  onOpenFile(cb) {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('chays:open-file', listener)
    return () => ipcRenderer.removeListener('chays:open-file', listener)
  },
  /** App menu items the desktop shell adds (e.g. File > Open Image…). */
  onMenuCommand(cb) {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('chays:menu-command', listener)
    return () => ipcRenderer.removeListener('chays:menu-command', listener)
  },
})
