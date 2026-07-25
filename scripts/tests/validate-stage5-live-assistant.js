const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));

for (const file of [
  'desktop-app/src/main/question-detector.js',
  'desktop-app/src/main/answer-matcher.js',
  'desktop-app/src/main/assistant-overlay.js',
  'desktop-app/src/assistant-overlay.html',
  'desktop-app/src/assistant-preload.js',
  'desktop-app/src/assistant-overlay-renderer.js',
  'desktop-app/src/assistant-overlay.css',
  'local-meet-bridge/src/main/java/local/meettranslator/model/InterviewSuggestionRequest.java'
]) assert.ok(exists(file), `Missing Stage 5 file: ${file}`);

const main = read('desktop-app/src/main.js');
assert.match(main, /\/interview\/suggest-answer/);
assert.match(main, /matchAnswerLibrary/);
assert.match(main, /questionDetector\.consume/);
assert.match(main, /createAssistantOverlayController/);
assert.doesNotMatch(main, /ttsAudio\([^)]*interview/i, 'Live Assistant must not auto-TTS suggestions.');

const overlay = read('desktop-app/src/main/assistant-overlay.js');
assert.match(overlay, /setContentProtection/);
assert.match(overlay, /INTERVIEW_ASSISTANT_AUTO_ANALYZE/);
const openAi = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
assert.match(openAi, /json_schema/);
assert.match(openAi, /Never invent employers, dates, metrics/);
assert.ok((openAi.match(/\.put\("store", false\)/g) || []).length >= 2, 'Responses API calls must opt out of storage.');
const html = read('desktop-app/src/index.html');
assert.match(html, /id="liveAssistantScreen"/);
assert.match(html, /id="assistantAutoAnalyze"/);
console.log('Stage 5 Live Interview Assistant validation: OK');
