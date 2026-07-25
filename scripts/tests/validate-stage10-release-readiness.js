const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (relative, patterns) => {
  const text = read(relative);
  for (const pattern of patterns) {
    if (!text.includes(pattern)) throw new Error(`${relative} is missing: ${pattern}`);
  }
};

const pkg = JSON.parse(read('desktop-app/package.json'));
if (pkg.version !== '1.0.17') throw new Error(`Expected desktop version 1.0.17, found ${pkg.version}`);
if (!String(pkg.scripts?.['test:architecture'] || '').includes('validate-stage10-release-readiness.js')) {
  throw new Error('Stage 10 architecture validator is not wired into npm test.');
}

for (const relative of [
  'desktop-app/src/main/security-guard.js',
  'desktop-app/src/main/diagnostics.js',
  'desktop-app/test/security-guard.test.js',
  'desktop-app/test/diagnostics.test.js'
]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing Stage 10 file: ${relative}`);
}

requireText('desktop-app/src/main.js', [
  'app.requestSingleInstanceLock()',
  "ipcMain.handle('diagnostics:load'",
  "ipcMain.handle('diagnostics:run'",
  "ipcMain.handle('diagnostics:reset-transient'",
  "ipcMain.handle('diagnostics:export'",
  'constantTimeEqual(expectedToken, token)',
  'createSlidingWindowRateLimiter',
  'Content-Type must be application/json.',
  'Too many local requests. Retry shortly.'
]);
requireText('desktop-app/src/preload.js', [
  'diagnosticsLoad:',
  'diagnosticsRun:',
  'diagnosticsResetTransient:',
  'diagnosticsExport:'
]);
requireText('desktop-app/src/index.html', [
  'id="openDiagnostics"',
  'id="diagnosticsScreen"',
  'id="diagnosticsReportPreview"',
  'Content-Security-Policy'
]);
requireText('desktop-app/src/renderer.js', [
  'function renderDiagnostics(report)',
  'async function loadDiagnostics(run = false)',
  "showView('diagnostics')",
  'diagnosticsResetTransient()'
]);
requireText('desktop-app/src/main/window-manager.js', [
  "setWindowOpenHandler(() => ({ action: 'deny' }))",
  "webPreferences: {",
  'contextIsolation: true',
  'nodeIntegration: false',
  'sandbox: true'
]);
requireText('desktop-app/src/main/assistant-overlay.js', ["setWindowOpenHandler(() => ({ action: 'deny' }))"]);
requireText('desktop-app/src/main/subtitle-overlay.js', ["setWindowOpenHandler(() => ({ action: 'deny' }))"]);
for (const relative of [
  'desktop-app/src/index.html',
  'desktop-app/src/assistant-overlay.html',
  'desktop-app/src/subtitle-overlay.html'
]) {
  requireText(relative, ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]);
}
requireText('scripts/desktop/build-windows-installer.ps1', [
  'RELEASE_MANIFEST.json',
  '.sha256',
  'ExpectedInstallerName',
  'diagnosticsExcludeSecrets'
]);

const html = read('desktop-app/src/index.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicateIds)].join(', ')}`);

console.log('Stage 10 release-readiness architecture validation: OK');
