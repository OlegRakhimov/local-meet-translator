'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function versionAtLeast(actual, minimum) {
  const a = String(actual || '').split('.').map(Number);
  const b = String(minimum || '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(versionAtLeast(pkg.version, '1.0.26'), `Desktop version must be 1.0.26 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage15-contextual-utterance-dispatcher.js'), 'Stage 15 validator is not wired into npm test.');

const classifier = read('desktop-app/src/main/utterance-classifier.js');
for (const token of ['recommendation', 'request', 'constraint', 'correction', 'new-input', 'new-task', 'ambiguous']) {
  assert(classifier.includes(`'${token}'`), `Context classifier type is missing: ${token}`);
}
assert(classifier.includes('normalizeClassification'), 'AI classification normalization is missing.');
assert(classifier.includes('previewActiveInputs'), 'Semantic active-input preview is missing.');
assert(classifier.includes('isAutomaticChange'), 'Confidence-aware automatic dispatcher policy is missing.');
assert(!/includes\(['"]HashMap['"]\)/.test(classifier), 'Classifier must not dispatch by a hard-coded HashMap keyword.');

const main = read('desktop-app/src/main.js');
assert(main.includes('/interview/classify-utterance'), 'Desktop does not call the semantic classification endpoint.');
assert(main.includes('classifyAndDispatchCodingUtterance'), 'Context classification dispatcher is missing.');
assert(main.includes('applyCodingChange'), 'Coding solution revision action is missing.');
assert(main.includes('dismissCodingChange'), 'Recommendation/ambiguous dismissal action is missing.');
assert(main.includes('queueCodingUtterance(deliveredEvent)'), 'Active Coding Focus utterances are not queued for semantic classification.');
assert(main.includes('classification.type === \'recommendation\'') || main.includes("classification.type === 'remark'"), 'Semantic type routing is missing.');

const state = read('desktop-app/src/main/coding-focus-state.js');
assert(state.includes('activeInputs'), 'Coding Focus does not retain active interviewer inputs.');
assert(state.includes('pendingChange'), 'Coding Focus does not retain a pending contextual action.');
assert(state.includes('commitActiveInputs'), 'Coding Focus cannot atomically commit revised inputs.');
assert(state.includes('updateContext'), 'Live feed classifications cannot be updated in place.');

const html = read('desktop-app/src/assistant-overlay.html');
for (const id of ['pendingCodingChangeBlock', 'applyCodingChange', 'dismissCodingChange', 'activeCodingInputs']) {
  assert(html.includes(`id="${id}"`), `Contextual dispatcher UI is missing: ${id}`);
}
const renderer = read('desktop-app/src/assistant-overlay-renderer.js');
assert(renderer.includes('codingUi.recommendation'), 'Recommendation label is missing.');
assert(renderer.includes("control('applyCodingChange')"), 'Apply contextual change control is not wired.');
assert(renderer.includes("control('dismissCodingChange')"), 'Dismiss contextual change control is not wired.');

const bridge = read('local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java');
const ai = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
const contract = read('local-meet-bridge/src/main/java/local/meettranslator/model/InterviewUtteranceClassificationRequest.java');
assert(bridge.includes('/interview/classify-utterance'), 'Bridge semantic classification route is missing.');
assert(ai.includes('buildUtteranceClassificationSchema'), 'Strict semantic classification schema is missing.');
assert(ai.includes('Judge communicative intent from wording and context'), 'Classifier instructions do not require context-based intent analysis.');
assert(ai.includes('affectedInputIds'), 'Correction/replacement input routing is missing.');
assert(contract.includes('recentUtterances'), 'Classification request does not carry recent utterance context.');
assert(contract.includes('activeInputs'), 'Classification request does not carry active interviewer inputs.');

console.log('Stage 15 contextual utterance classifier and action dispatcher validation: OK');
