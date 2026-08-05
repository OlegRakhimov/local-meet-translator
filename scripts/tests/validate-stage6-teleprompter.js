const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));

for (const file of [
  'desktop-app/src/main/teleprompter.js',
  'desktop-app/test/teleprompter.test.js',
  'desktop-app/src/assistant-overlay.html',
  'desktop-app/src/assistant-overlay-renderer.js',
  'desktop-app/src/main/assistant-overlay.js'
]) assert.ok(exists(file), `Missing Stage 6 file: ${file}`);

const teleprompter = read('desktop-app/src/main/teleprompter.js');
assert.match(teleprompter, /splitAnswerIntoChunks/);
assert.match(teleprompter, /loadPending/);
assert.match(teleprompter, /settings\.frozen/);
assert.doesNotMatch(teleprompter, /OpenAI|fetch\(|http\.request|tts/i, 'Teleprompter must only format an existing suggestion locally.');

const controller = read('desktop-app/src/main/assistant-overlay.js');
assert.match(controller, /INTERVIEW_TELEPROMPTER_CHUNK_MODE/);
assert.match(controller, /teleprompter\.loadSuggestion/);
assert.match(controller, /setContentProtection/);
assert.match(controller, /CommandOrControl\+Shift\+Right/);
assert.match(controller, /CommandOrControl\+Shift\+F/);
assert.match(controller, /function resizeWindow\(direction\)/);
assert.match(controller, /compactWidth: 760/);

const html = read('desktop-app/src/index.html');
assert.match(html, /id="assistantTeleprompterChunkMode"/);
assert.match(html, /id="assistantToggleFreeze"/);
assert.match(html, /id="assistantLoadPending"/);
assert.match(html, /id="assistantFinishAnswer"/);

const overlay = read('desktop-app/src/assistant-overlay.html');
assert.match(overlay, /ПОДСКАЗКА ДЛЯ ОТВЕТА/);
assert.match(overlay, /id="activeChunk"/);
assert.match(overlay, /id="pendingBlock"/);
assert.match(overlay, /id="finishCurrentAnswer"/);
assert.match(overlay, /Следующий вопрос/);
assert.match(overlay, /Подробности решения/);
assert.match(overlay, /id="decreaseAssistantOverlay"/);
assert.match(overlay, /id="increaseAssistantOverlay"/);

const main = read('desktop-app/src/main.js');
assert.match(main, /case 'nextChunk'/);
assert.match(main, /case 'freezeTeleprompter'/);
assert.match(main, /case 'finishAnswer'/);
assert.match(main, /case 'decreaseWindowSize'/);
assert.match(main, /case 'increaseWindowSize'/);
assert.doesNotMatch(main, /ttsAudio\([^)]*teleprompter/i, 'Teleprompter must not auto-speak answers.');

console.log('Stage 6 Russian assistant teleprompter validation: OK');
