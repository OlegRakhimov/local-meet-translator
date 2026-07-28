
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(pkg.version === '1.0.29', 'Desktop version must be 1.0.29.');
assert(pkg.scripts['test:architecture'].includes('validate-stage15-2-structured-coding-context.js'), 'Stage 15.2 validator must be part of architecture tests.');

const helper = read('desktop-app/src/main/interview-context.js');
assert(helper.includes('buildCodingRequestParts'), 'Structured coding request helper is missing.');
assert(helper.includes('currentTask:'), 'currentTask part is missing.');
assert(helper.includes('currentSolution:'), 'currentSolution part is missing.');
assert(helper.includes('activeInputs:'), 'activeInputs part is missing.');
assert(helper.includes('latestUtterance:'), 'latestUtterance part is missing.');
assert(helper.includes('recentContext:'), 'recentContext part is missing.');

const main = read('desktop-app/src/main.js');
assert(main.includes("require('./main/interview-context')"), 'Desktop main process must use the structured context helper.');
assert(!main.includes('function buildCodingRevisionPrompt'), 'The old concatenated coding revision prompt must be removed.');
assert(main.includes('question: question.text') && main.includes('question: focus.task.text'), 'Follow-up and revision requests must keep question bounded.');
assert((main.match(/\.\.\.contextParts/g) || []).length >= 2, 'Both coding request paths must send structured context parts.');

const request = read('local-meet-bridge/src/main/java/local/meettranslator/model/InterviewSuggestionRequest.java');
for (const field of ['currentTask', 'currentSolution', 'activeInputs', 'latestUtterance', 'recentContext']) {
  assert(request.includes(field), `Bridge request model is missing ${field}.`);
}
assert(request.includes('requiredText(json, "question", 2_400)'), 'The bounded question contract must remain in place.');

const openAi = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
assert(openAi.includes('Structured coding revision mode:'), 'OpenAI prompt must support structured revision mode.');
assert(openAi.includes('Structured coding follow-up mode:'), 'OpenAI prompt must support structured follow-up mode.');
assert(openAi.includes('activeInterviewerInputs'), 'OpenAI prompt must receive active inputs separately.');
assert(openAi.includes('latestUtterance'), 'OpenAI prompt must receive the latest utterance separately.');

const test = read('desktop-app/test/interview-context.test.js');
assert(test.includes('structured coding context keeps request parts separate and bounded'), 'Structured context unit test is missing.');

console.log('Stage 15.2 structured coding context validation: OK');
