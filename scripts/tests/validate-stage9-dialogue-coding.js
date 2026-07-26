'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const mustInclude = (text, value, label) => {
  if (!text.includes(value)) throw new Error(`${label} is missing: ${value}`);
};

const detector = read('desktop-app/src/main/question-detector.js');
const main = read('desktop-app/src/main.js');
const overlay = read('desktop-app/src/main/assistant-overlay.js');
const overlayHtml = read('desktop-app/src/assistant-overlay.html');
const overlayRenderer = read('desktop-app/src/assistant-overlay-renderer.js');
const teleprompter = read('desktop-app/src/main/teleprompter.js');
const request = read('local-meet-bridge/src/main/java/local/meettranslator/model/InterviewSuggestionRequest.java');
const openai = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
const pkg = JSON.parse(read('desktop-app/package.json'));

if (!['1.0.16', '1.0.17', '1.0.18'].includes(pkg.version)) throw new Error(`Expected desktop version 1.0.16, 1.0.17 or 1.0.18, got ${pkg.version}`);
for (const symbol of ['classifyInterviewUtterance', 'looksLikeCodingTask', 'looksLikeCodingContinuation', "kind: 'remark'", "kind: 'coding-task'"]) {
  mustInclude(detector, symbol, 'Dialogue classifier');
}
mustInclude(main, "taskKind === 'coding-task'", 'Coding task routing');
mustInclude(main, 'codingLanguage', 'Coding language routing');
mustInclude(overlay, 'codeWalkthrough', 'Protected coding suggestion sanitizer');
mustInclude(overlayHtml, 'id="codingSolutionBlock"', 'Protected coding solution UI');
mustInclude(overlayHtml, 'id="codeText"', 'Protected code display');
mustInclude(overlayRenderer, "suggestion.responseType === 'coding_solution'", 'Coding UI renderer');
mustInclude(teleprompter, 'speakingNotes', 'Coding teleprompter speaking notes');
mustInclude(request, 'String taskKind', 'Java coding request contract');
mustInclude(request, 'String codingLanguage', 'Java coding language contract');
for (const field of ['responseType', 'approachSummary', 'implementationPlan', 'codeLanguage', 'codeWalkthrough', 'complexity', 'edgeCases', 'speakingNotes']) {
  mustInclude(openai, `"${field}"`, 'Structured coding response schema');
}
if (!openai.includes('.put("store", false)')) throw new Error('Responses API request must keep store=false.');
console.log('Stage 9 dialogue context and coding task validation: OK');
