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
assert(teleprompter.includes('answerLocked'), 'A ready answer must be locked until an explicit user action.');
assert(teleprompter.includes('loadedPending: false'), 'Unfreezing must not replace the current answer automatically.');
assert(main.includes("case 'finishAnswer'"), 'The user must be able to finish the current answer and reset transient state.');
assert(main.includes('function finishAnswer('), 'Finish answer must have a narrow operation separate from session reset.');
assert(main.includes('function finishCodingTask('), 'Finishing a coding task must be separate from finishing an answer.');
assert(main.includes('function resetDiagnostics('), 'Diagnostics reset must be a separate operation.');
assert(overlay.includes('pendingError'), 'Pending answer failures must be represented separately from the current answer error.');
assert(overlay.includes('dismissPending'), 'The user must be able to dismiss a failed pending answer.');
const startHandler = main.indexOf("ipcMain.handle('extension:startTranslation'");
const failedAckGuard = main.indexOf('if (!ack.ok)', startHandler);
const confirmedStartReset = main.indexOf("resetAssistantForNewSession('A new translation session started.", startHandler);
assert(startHandler >= 0 && failedAckGuard > startHandler && confirmedStartReset > failedAckGuard,
  'Assistant state must reset only after the extension confirms startup.');
assert(renderer.includes('автоматически подготовит ответ'), 'Overlay guidance must reflect enabled automatic analysis in Russian.');
assert(renderer.includes("const mode = state.mode || 'WAITING'"), 'The overlay must render an explicit assistant mode.');
assert(renderer.includes("control('nextQuestion')"), 'The next-question action must replace the old load-pending wording.');
assert(overlay.includes('ASSISTANT_MODES'), 'The assistant controller must expose explicit workflow modes.');
assert(overlay.includes('function finishCodingTask()'), 'Coding task completion must be a narrow overlay operation.');
assert(main.includes('ensureCurrentLiveInterviewSession'), 'Detected questions must be saved in an automatically created session.');
assert(main.includes('saveCurrentAnswerToLibrary'), 'The current answer must be saveable to Answer Library.');
assert(isVersionAtLeast(pkg.version, '1.0.15'), 'Desktop version must be 1.0.15 or newer.');

console.log('Stage 8.1 automatic assistant analysis hotfix validation: OK');
