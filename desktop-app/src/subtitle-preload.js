const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmtSubtitle', {
  status: () => ipcRenderer.invoke('subtitle-overlay:status'),
  control: (action, payload = {}) => ipcRenderer.invoke('subtitle-overlay:control', action, payload),
  onState: (callback) => ipcRenderer.on('subtitle-overlay:state', (_event, state) => callback(state)),
  onEvent: (callback) => ipcRenderer.on('subtitle-overlay:event', (_event, item) => callback(item)),
  onClear: (callback) => ipcRenderer.on('subtitle-overlay:clear', () => callback())
});
