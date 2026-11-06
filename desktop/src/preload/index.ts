import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/contract'

const desktopBridge: DesktopBridge = {
  getRuntimeState: () => ipcRenderer.invoke('runtime:get-state'),
  getCourses: () => ipcRenderer.invoke('runtime:get-courses'),
  getLogs: () => ipcRenderer.invoke('logs:get-all'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  testEmail: (config) => ipcRenderer.invoke('email:test', config),
  openLogFolder: () => ipcRenderer.invoke('logs:open-folder'),
  startMonitoring: () => ipcRenderer.invoke('runtime:start'),
  stopMonitoring: () => ipcRenderer.invoke('runtime:stop'),
  onRuntimeState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ) => callback(state)
    ipcRenderer.on('runtime:state', listener)
    return () => ipcRenderer.removeListener('runtime:state', listener)
  },
  onLog: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      entry: Parameters<typeof callback>[0],
    ) => callback(entry)
    ipcRenderer.on('logs:entry', listener)
    return () => ipcRenderer.removeListener('logs:entry', listener)
  },
  beginLogin: (region) => ipcRenderer.invoke('login:begin', region),
  cancelLogin: () => ipcRenderer.invoke('login:cancel'),
  onLoginUpdate: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: Parameters<typeof callback>[0],
    ) => callback(update)
    ipcRenderer.on('login:update', listener)
    return () => ipcRenderer.removeListener('login:update', listener)
  },
  onSpeak: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) =>
      callback(message)
    ipcRenderer.on('notification:speak', listener)
    return () => ipcRenderer.removeListener('notification:speak', listener)
  },
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  openReleasePage: () => ipcRenderer.invoke('update:open-release'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
}

contextBridge.exposeInMainWorld('desktop', desktopBridge)
