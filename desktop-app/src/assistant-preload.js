const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lmtAssistantOverlay', {
  hide: () => ipcRenderer.send('assistant-overlay:hide'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('assistant-overlay:state', handler);
    return () => ipcRenderer.removeListener('assistant-overlay:state', handler);
  }
});
