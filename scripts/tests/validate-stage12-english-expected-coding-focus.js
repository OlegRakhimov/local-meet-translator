'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function versionAtLeast(actual, minimum) {
  const left = String(actual || '').split('.').map(Number);
  const right = String(minimum || '').split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a !== b) return a > b;
  }
  return true;
}

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(versionAtLeast(pkg.version, '1.0.20'), `Desktop version must be 1.0.20 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage12-english-expected-coding-focus.js'), 'Stage 12 validator is not wired into npm test.');

const html = read('desktop-app/src/index.html');
assert(html.includes('value="en-expected"'), 'English expected is not available in the desktop language controls.');
assert(html.includes('id="sourceLanguageModes"'), 'Source-language mode suggestions are missing.');
const assistantHtml = read('desktop-app/src/assistant-overlay.html');
assert(assistantHtml.includes('id="codingFocusPanel"'), 'Coding Focus panel is missing.');
assert(assistantHtml.includes('id="liveContextFeed"'), 'Coding Focus live interviewer feed is missing.');
assert(assistantHtml.includes('id="codingFollowUpBlock"'), 'Coding Focus follow-up block is missing.');
assert(read('desktop-app/src/assistant-overlay-renderer.js').includes('liveContextTranslation'), 'Coding Focus does not show translated interviewer context separately.');

const main = read('desktop-app/src/main.js');
assert(main.includes('analyzeCodingFollowUp'), 'Separate coding follow-up analysis is missing.');
assert(main.includes("relation === 'coding-follow-up'") || main.includes("classification.type === 'follow-up'"), 'Coding follow-up routing is missing.');
assert(main.includes("relation === 'coding-context'") || main.includes('previewActiveInputs'), 'Coding context-change routing is missing.');
assert(main.includes("relation === 'new-coding-task'") || main.includes("classification.type === 'new-task'"), 'Pending new coding-task routing is missing.');
assert(main.includes('assistantOverlay.addCodingContext'), 'Live coding context is not forwarded to the assistant overlay.');

const focusState = read('desktop-app/src/main/coding-focus-state.js');
assert(focusState.includes('createCodingFocusState'), 'Coding Focus state controller is missing.');
assert(focusState.includes('setFollowUpSuggestion'), 'Separate follow-up answer state is missing.');
assert(focusState.includes('setPendingTask'), 'Pending coding task state is missing.');

const detector = read('desktop-app/src/main/question-detector.js');
assert(detector.includes("kind: 'coding-follow-up'"), 'Question detector does not classify coding follow-ups.');
assert(detector.includes("kind: 'new-coding-task'"), 'Question detector does not preserve new tasks as pending.');
assert(detector.includes('looksLikeNewCodingTask'), 'New coding-task transition detection is missing.');
assert(detector.includes('30 * 60_000'), 'Coding context window is too short for a real coding interview.');

const bridge = read('local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java');
const recognition = read('local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java');
assert(bridge.includes('EnglishExpectedRecognition.shouldRetry'), 'Bridge does not retry suspicious English-expected transcripts.');
assert(bridge.includes('transcriptionRetried'), 'Bridge does not expose retry metadata.');
assert(recognition.includes('Character.UnicodeScript.LATIN'), 'English-expected script validation is missing.');
assert(recognition.includes('chooseBetterCandidate'), 'English retry candidate selection is missing.');

for (const extension of ['chrome-extension', 'edge-extension', 'firefox-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.1'), `${extension} version must be 1.7.1 or newer.`);
  const runtime = extension === 'firefox-extension' ? read(`${extension}/firefox_audio.js`) : read(`${extension}/offscreen.js`);
  assert(runtime.includes('data.transcriptionRetried'), `${extension} does not report automatic English retry.`);
}

console.log('Stage 12 English expected and Coding Focus validation: OK');
