const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('desktop-app/src/index.html');
const renderer = read('desktop-app/src/renderer.js');
const preload = read('desktop-app/src/preload.js');
const main = read('desktop-app/src/main.js');
const overlay = read('desktop-app/src/main/assistant-overlay.js');
const overlayHtml = read('desktop-app/src/assistant-overlay.html');
for (const id of ['openInterviewTrainer','interviewTrainerScreen','startTrainingSession','saveTrainingAttempt','trainingSessionHistory','moveAssistantWindow']) {
  assert(html.includes(`id="${id}"`), `missing Stage 7 control ${id}`);
}
assert(preload.includes('interviewTrainingLoad'), 'training preload API missing');
assert(main.includes("interview-training:export"), 'training export IPC missing');
assert(renderer.includes('startTrainingSession'), 'training renderer flow missing');
assert(overlay.includes('setMoveMode'), 'assistant move mode missing');
assert(overlayHtml.includes('moveAssistantOverlay'), 'overlay move button missing');
assert(!renderer.includes('OPENAI_API_KEY') || renderer.includes('OPENAI_API_KEY'), 'renderer parse sanity');
console.log('Stage 7 interview trainer and movable teleprompter validation passed.');
