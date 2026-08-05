const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const required = [
  'desktop-app/src/main/config-store.js',
  'desktop-app/src/main/session-state.js',
  'desktop-app/src/main/window-manager.js',
  'desktop-app/src/main/extension-state.js',
  'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java',
  'local-meet-bridge/src/main/java/local/meettranslator/config/BridgeConfig.java',
  'local-meet-bridge/src/main/java/local/meettranslator/http/HttpSupport.java',
  'local-meet-bridge/src/main/java/local/meettranslator/http/RequestRegistry.java',
  'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java'
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing stage-1 architecture file: ${relative}`);
}

const mainJs = fs.readFileSync(path.join(root, 'desktop-app/src/main.js'), 'utf8');
const mainJava = fs.readFileSync(path.join(root, 'local-meet-bridge/src/main/java/local/meettranslator/Main.java'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'desktop-app/src/index.html'), 'utf8');

if (!mainJs.includes("require('./main/config-store')")) throw new Error('Desktop main process does not use ConfigStore.');
if (!mainJs.includes('new SessionStateMachine')) throw new Error('Desktop session state machine is not integrated.');
if (!mainJs.includes("ipcMain.handle('app:info'")) throw new Error('Dynamic app info IPC is missing.');
if (!mainJava.includes('new BridgeServer(config)')) throw new Error('Java Main must delegate to BridgeServer.');
if (/v1\.0\.4/.test(indexHtml)) throw new Error('Desktop UI still contains the obsolete hard-coded v1.0.4.');

console.log('Stage 1 architecture validation passed.');
