const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(root, 'desktop-app', 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop-app', 'src', 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Desktop controls validation failed: ${message}`);
    process.exit(1);
  }
}

const handlerIndex = renderer.indexOf('$("startTranslation").onclick');
const settingsLoadIndex = renderer.indexOf('const settings = await window.lmt.load()');
assert(handlerIndex >= 0, 'subtitles Start handler is missing');
assert(settingsLoadIndex >= 0, 'settings initialization is missing');
assert(handlerIndex < settingsLoadIndex, 'Start/Stop handlers must be bound before asynchronous settings/health initialization');
assert(renderer.includes('[UI] Start voice translation clicked.'), 'voice button diagnostic log is missing');
assert(renderer.includes("runUiAction('Start subtitles only clicked.'"), 'subtitle button diagnostic log is missing');
assert(renderer.includes('[RENDERER PROMISE ERROR]'), 'renderer rejection diagnostics are missing');
assert(main.includes('UI requested ${requestedMode} translation.'), 'main-process start request diagnostic is missing');
assert(main.includes('Attempting automatic start...'), 'automatic bridge start fallback is missing');
assert(main.includes('Extension command delivered:'), 'desktop-to-extension command delivery diagnostic is missing');

console.log('Desktop controls validation passed.');
