const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmt', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  sessionStatus: () => ipcRenderer.invoke('session:status'),
  subtitleStatus: () => ipcRenderer.invoke('subtitle-overlay:status'),
  subtitleControl: (action, payload = {}) => ipcRenderer.invoke('subtitle-overlay:control', action, payload),
  candidateProfileLoad: () => ipcRenderer.invoke('candidate-profile:load'),
  candidateProfileSave: (profile) => ipcRenderer.invoke('candidate-profile:save', profile || {}),
  candidateProfileReset: () => ipcRenderer.invoke('candidate-profile:reset'),
  candidateProfileImport: () => ipcRenderer.invoke('candidate-profile:import'),
  candidateProfileExport: (profile) => ipcRenderer.invoke('candidate-profile:export', profile || {}),
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
