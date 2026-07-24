const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function requireText(relative, pattern, message) {
  const value = read(relative);
  if (!pattern.test(value)) throw new Error(`${relative}: ${message}`);
}

requireText('desktop-app/src/main.js', /candidate-profile:load/, 'candidate profile IPC is missing');
requireText('desktop-app/src/main.js', /createSubtitleDedupeGuard/, 'desktop subtitle dedupe is missing');
requireText('desktop-app/src/main/subtitle-overlay.js', /replaceEventId/, 'subtitle completion replacement is missing');
requireText('desktop-app/src/subtitle-overlay-renderer.js', /replaceEventId/, 'renderer completion replacement is missing');
requireText('desktop-app/src/index.html', /candidateFactsConfirmed/, 'confirmed facts UI is missing');
requireText('desktop-app/src/preload.js', /candidateProfileImport/, 'candidate profile preload API is missing');
requireText('chrome-extension/offscreen.js', /isIncomingHistoryDuplicate/, 'Chrome incoming history dedupe is missing');
requireText('edge-extension/offscreen.js', /isIncomingHistoryDuplicate/, 'Edge incoming history dedupe is missing');
requireText('firefox-extension\/firefox_audio.js'.replace('\\/', '/'), /isIncomingHistoryDuplicate/, 'Firefox incoming history dedupe is missing');

for (const extension of ['chrome-extension', 'edge-extension', 'firefox-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  if (manifest.version !== '1.6.9') throw new Error(`${extension}: expected version 1.6.9`);
}

const pkg = JSON.parse(read('desktop-app/package.json'));
const versionParts = String(pkg.version || '').split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some(Number.isNaN) || versionParts[0] !== 1 || versionParts[1] !== 0 || versionParts[2] < 9) {
  throw new Error('desktop-app: expected version 1.0.9 or newer');
}

console.log('Stage 3 profile and subtitle dedupe validation: OK');
