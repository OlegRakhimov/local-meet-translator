const path = require('path');

function createWindowManager({ BrowserWindow, preloadPath, htmlPath, onCloseRequested }) {
  let mainWindow = null;

  function send(channel, payload) {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const contents = mainWindow.webContents;
      if (!contents || contents.isDestroyed()) return false;
      contents.send(channel, payload);
      return true;
    } catch (_) {
      return false;
    }
  }

  function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    mainWindow = new BrowserWindow({
      width: 1060,
      height: 880,
      minWidth: 820,
      minHeight: 680,
      webPreferences: {
        preload: path.resolve(preloadPath),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    mainWindow.loadFile(path.resolve(htmlPath));
    mainWindow.on('close', (event) => {
      if (typeof onCloseRequested === 'function') onCloseRequested(event, mainWindow);
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    return mainWindow;
  }

  return {
    createMainWindow,
    send,
    getMainWindow: () => mainWindow,
    destroyMainWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      mainWindow = null;
    }
  };
}

module.exports = { createWindowManager };
