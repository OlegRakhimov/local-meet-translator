'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const versionAtLeast = (actual, minimum) => {
  const a = String(actual || '').split('.').map(Number);
  const b = String(minimum || '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(versionAtLeast(pkg.version, '1.0.27'), `Expected desktop 1.0.27 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage15-1-transcript-learning-aids.js'), 'Stage 15.1 validator is not wired into npm test.');
for (const extension of ['chrome-extension', 'edge-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.5'), `${extension} must be 1.7.5 or newer.`);
  const runtime = read(`${extension}/offscreen.js`);
  assert(runtime.includes('consumeWindowStats'), `${extension} has no per-chunk silence statistics.`);
  assert(runtime.includes('[TRANSCRIPT DROPPED] silence detected'), `${extension} has no silence-drop log.`);
  assert(runtime.includes('[TRANSCRIPT DROPPED] prompt echo detected'), `${extension} has no prompt-echo log.`);
  assert(runtime.includes('data.transcriptDropped'), `${extension} does not stop dropped transcripts.`);
}
const recognition = read('local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java');
assert(recognition.includes('isPromptEcho'), 'Prompt-echo detector is missing.');
assert(recognition.includes('TECHNICAL_TRANSCRIPTION_VOCABULARY'), 'Safe technical vocabulary prompt is missing.');
const openAi = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
assert(!openAi.includes('Transcribe exactly in English.'), 'Old natural-language transcription prompt is still present.');
assert(openAi.includes('generateInterviewLearningAids'), 'Learning-aids AI method is missing.');
const bridge = read('local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java');
assert(bridge.includes('transcriptDropped'), 'Bridge does not expose dropped-transcript metadata.');
assert(bridge.includes('/interview/generate-learning-aids'), 'Learning-aids bridge endpoint is missing.');
const store = read('desktop-app/src/main/answer-library-store.js');
assert(store.includes('usefulPhrases'), 'Answer Library does not persist useful phrases.');
const html = read('desktop-app/src/index.html');
for (const id of ['answerUsefulPhrases','generateAnswerLearningAids','generateMissingLearningAids','trainerKeywordList','trainerUsefulPhraseList']) {
  assert(html.includes(`id="${id}"`), `Missing Stage 15.1 UI control: ${id}`);
}
const renderer = read('desktop-app/src/renderer.js');
assert(renderer.includes('generateMissingLearningAidsForLibrary'), 'Bulk learning-aids flow is missing.');
assert(renderer.includes('renderTrainerLearningAids'), 'Trainer does not render learning aids.');
assert(html.includes('guideTranscriptGuardTitle') && html.includes('guideLearningAidsTitle') && html.includes('guideClassifierTitle'), 'Built-in instructions were not expanded.');
console.log('Stage 15.1 transcript guard and learning aids validation: OK');