const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const required = [
  'desktop-app/src/main/subtitle-overlay.js',
  'desktop-app/src/subtitle-preload.js',
  'desktop-app/src/subtitle-overlay.html',
  'desktop-app/src/subtitle-overlay.css',
  'desktop-app/src/subtitle-overlay-renderer.js'
];
for (const relative of required) assert(fs.existsSync(path.join(root, relative)), `Missing Stage 2 file: ${relative}`);

const main = read('desktop-app/src/main.js');
const overlayController = read('desktop-app/src/main/subtitle-overlay.js');
assert(main.includes("'/extension/subtitle'"), 'Desktop subtitle endpoint is missing.');
assert(main.includes("ipcMain.handle('subtitle-overlay:control'"), 'Subtitle window IPC controls are missing.');
assert(overlayController.includes('setContentProtection(enable)'), 'Subtitle window does not apply Electron content protection.');
assert(overlayController.indexOf('applyContentProtection();') < overlayController.indexOf('subtitleWindow.loadFile'), 'Content protection must be applied before loading subtitle content.');
assert(overlayController.includes('setIgnoreMouseEvents'), 'Click-through mode is missing.');
assert(overlayController.includes("globalShortcut.register"), 'Subtitle hotkeys are missing.');
assert(overlayController.includes("desktopCapturer.getSources"), 'Capture-protection self-test is missing.');

for (const browser of ['chrome-extension', 'edge-extension']) {
  const background = read(`${browser}/background.js`);
  const content = read(`${browser}/content_script.js`);
  assert(background.includes('/extension/subtitle'), `${browser} does not send subtitles to desktop.`);
  assert(!content.includes('local-meet-translator-overlay'), `${browser} still injects a subtitle overlay into the meeting DOM.`);
  assert(!content.includes('document.createElement("div")'), `${browser} content script still creates subtitle DOM.`);
}

const firefoxManifest = JSON.parse(read('firefox-extension/manifest.json'));
const firefoxContentScripts = JSON.stringify(firefoxManifest.content_scripts || []);
assert(!firefoxContentScripts.includes('content_script.js'), 'Firefox still injects the obsolete subtitle DOM script.');
assert(read('firefox-extension/background.js').includes('/extension/subtitle'), 'Firefox does not forward subtitles to desktop.');
assert(read('firefox-extension/firefox_audio.js').includes('LMTDesktopSubtitles'), 'Firefox audio pipeline is not connected to desktop subtitles.');

console.log('Stage 2 protected subtitle window validation passed.');
