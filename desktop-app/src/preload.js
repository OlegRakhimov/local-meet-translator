const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmt', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  sessionStatus: () => ipcRenderer.invoke('session:status'),
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings),
  startBridge: () => ipcRenderer.invoke('bridge:start'),
  stopBridge: () => ipcRenderer.invoke('bridge:stop'),
  startVoice: () => ipcRenderer.invoke('voice:start'),
  stopVoice: () => ipcRenderer.invoke('voice:stop'),
  health: () => ipcRenderer.invoke('health:check'),
  checkCable: () => ipcRenderer.invoke('audio:checkCable'),
  openExtension: () => ipcRenderer.invoke('extension:open'),
  startTranslation: (options) => ipcRenderer.invoke('extension:startTranslation', options || {}),
  stopTranslation: () => ipcRenderer.invoke('extension:stopTranslation'),
  openEnv: () => ipcRenderer.invoke('env:open'),
  onLog: (cb) => ipcRenderer.on('app:log', (_event, line) => cb(line))
});
