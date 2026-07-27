'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const main = read('desktop-app/src/main.js');
const coordinator = read('desktop-app/src/main/assistant-auto-analysis.js');
const teleprompter = read('desktop-app/src/main/teleprompter.js');
const overlay = read('desktop-app/src/main/assistant-overlay.js');
const renderer = read('desktop-app/src/assistant-overlay-renderer.js');
const pkg = JSON.parse(read('desktop-app/package.json'));

assert(main.includes('createAutomaticAnalysisCoordinator'), 'Main process must use the automatic analysis coordinator.');
assert(main.includes('initializeAssistantAutoAnalysis().queue(questionDecision.question)'), 'Detected questions must be debounced before automatic analysis.');
assert(main.indexOf('assistantOverlay.setAnalyzing(true)') < main.indexOf('await ensureBridgeForAssistant()'), 'Analyzing state must be visible while the bridge is starting.');
assert(coordinator.includes('lastCompletedKey'), 'Coordinator must suppress already completed duplicate questions.');
assert(coordinator.includes('running = { ...next }'), 'Coordinator must serialize analysis requests.');
assert(teleprompter.includes('loadedPending'), 'Unfreezing must explicitly handle pending answers.');
assert(overlay.includes('result.loadedPending'), 'Assistant overlay must synchronize after pending answer promotion.');
assert(renderer.includes('Automatic AI analysis is enabled.'), 'Overlay guidance must reflect enabled automatic analysis.');
assert(renderer.includes('teleprompter.frozen || teleprompter.pending'), 'Pending block must not show stale state while unfrozen.');
assert(isVersionAtLeast(pkg.version, '1.0.15'), 'Desktop version must be 1.0.15 or newer.');

console.log('Stage 8.1 automatic assistant analysis hotfix validation: OK');
