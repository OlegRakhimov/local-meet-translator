const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const requireText = (relative, values) => {
  const text = read(relative);
  for (const value of values) assert(text.includes(value), `${relative} is missing: ${value}`);
  return text;
};

function isVersionAtLeast(actual, minimum) {
  const actualParts = String(actual || '').split('.').map(Number);
  const minimumParts = String(minimum || '').split('.').map(Number);
  if (actualParts.length !== 3 || minimumParts.length !== 3) return false;
  if (actualParts.some(value => !Number.isInteger(value)) || minimumParts.some(value => !Number.isInteger(value))) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] !== minimumParts[index]) return actualParts[index] > minimumParts[index];
  }
  return true;
}

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(isVersionAtLeast(pkg.version, '1.0.18'), `Expected desktop version 1.0.18 or newer, got ${pkg.version}`);
assert(String(pkg.scripts?.['test:architecture'] || '').includes('validate-stage11-modern-workspace.js'), 'Stage 11 validator is not wired into npm test.');

const html = requireText('desktop-app/src/index.html', [
  'id="appSidebar"',
  'id="homeScreen"',
  'id="settingsScreen"',
  'id="translationControlScreen"',
  'id="systemScreen"',
  'id="instructionsScreen"',
  'id="quickStartSubtitles"',
  'id="quickShowSubtitleWindow"',
  'id="homeSubtitleProtection"',
  'id="openCandidateProfile"',
  'id="openAnswerLibrary"',
  'id="openInterviewTrainer"',
  'id="openLiveAssistant"',
  'id="openDiagnostics"'
]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(!duplicates.length, `Duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);

const home = html.slice(html.indexOf('id="homeScreen"'), html.indexOf('id="settingsScreen"'));
const settings = html.slice(html.indexOf('id="settingsScreen"'), html.indexOf('id="translationControlScreen"'));
const translation = html.slice(html.indexOf('id="translationControlScreen"'), html.indexOf('id="systemScreen"'));
assert(home.includes('subtitleWindowSettings'), 'Dashboard must retain the subtitle window controls.');
assert(home.includes('id="quickStartSubtitles"'), 'Dashboard must expose quick subtitle start.');
assert(!home.includes('id="openaiKey"'), 'OpenAI key must not remain on the dashboard.');
assert(!home.includes('id="startTranslation"'), 'Detailed translation start must live outside the dashboard.');
assert(settings.includes('id="openaiKey"') && settings.includes('id="save"'), 'Settings screen must contain API configuration and .env save.');
assert(translation.includes('id="startTranslation"') && translation.includes('id="enableOutgoingVoice"'), 'Translation screen must contain subtitle and outgoing voice controls.');

requireText('desktop-app/src/styles.css', [
  '.appShell', '.appSidebar', '.heroPanel', '.modernSwitch', '.guideGrid', '@media (max-width: 980px)'
]);
requireText('desktop-app/src/renderer.js', [
  'const VIEW_META =',
  'function updateViewChrome(view)',
  'async function quickStartSubtitles',
  'function syncHomeControlsFromSettings()',
  "showView('translation-control')",
  "showView('instructions')"
]);
requireText('desktop-app/src/i18n.js', [
  'navTranslation:', 'homeTitle:', 'quickPreferences:', 'instructionsTitle:'
]);

console.log('Stage 11 modern workspace validation: OK');
