const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lmtAssistantOverlay', {
  hide: () => ipcRenderer.send('assistant-overlay:hide'),
  control: (action, payload = {}) => ipcRenderer.invoke('interview-assistant:control', action, payload),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('assistant-overlay:state', handler);
    return () => ipcRenderer.removeListener('assistant-overlay:state', handler);
  }
});
