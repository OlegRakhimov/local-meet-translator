const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowManager } = require('../src/main/window-manager');

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.loaded = '';
    this.sent = [];
    this.webContents = {
      isDestroyed: () => false,
      send: (channel, payload) => this.sent.push({ channel, payload })
    };
  }
  loadFile(file) { this.loaded = file; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}

test('window manager creates a sandboxed main window and sends safely', () => {
  let created;
  function BrowserWindow(options) {
    created = new FakeWindow(options);
    return created;
  }
  const manager = createWindowManager({
    BrowserWindow,
    preloadPath: __filename,
    htmlPath: __filename,
    onCloseRequested: () => {}
  });
  manager.createMainWindow();
  assert.equal(created.options.webPreferences.contextIsolation, true);
  assert.equal(created.options.webPreferences.nodeIntegration, false);
  assert.equal(created.options.webPreferences.sandbox, true);
  assert.equal(manager.send('test', { ok: true }), true);
  manager.destroyMainWindow();
  assert.equal(manager.send('test', {}), false);
});
