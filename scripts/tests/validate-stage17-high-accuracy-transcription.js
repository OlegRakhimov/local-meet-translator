'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(pkg.scripts['test:architecture'].includes('validate-stage17-high-accuracy-transcription.js'), 'Stage 17 validator is not wired into npm test.');

const configStore = read('desktop-app/src/main/config-store.js');
assert(configStore.includes("result.OPENAI_TRANSCRIBE_MODEL ||= 'gpt-4o-transcribe'"), 'High-accuracy transcription model is not the desktop default.');
assert(configStore.includes('INCOMING_ACCURACY_MIGRATED_20260805'), 'One-time incoming accuracy migration is missing.');
assert(configStore.includes("result.EXT_CHUNK_SECONDS = '7'"), 'Seven-second incoming chunk migration is missing.');

for (const extension of ['chrome-extension', 'edge-extension']) {
  const runtime = read(`${extension}/offscreen.js`);
  assert(runtime.includes('transcriptionContextText'), `${extension} does not send recent accepted transcript context.`);
  assert(runtime.includes('data.transcriptionUncertain'), `${extension} does not preserve uncertainty metadata.`);
  assert(runtime.includes('rememberIncomingContext'), `${extension} does not retain trusted continuity context.`);
}
const firefox = read('firefox-extension/firefox_audio.js');
assert(firefox.includes('transcriptionContextText'), 'Firefox does not send recent accepted transcript context.');
assert(firefox.includes('data.transcriptionUncertain'), 'Firefox does not preserve uncertainty metadata.');

const recognition = read('local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java');
for (const marker of ['PRIMARY_MODE', 'RETRY_MODE', 'candidateAgreement', 'isTrusted', 'hasDetectedNonEnglishLanguage']) {
  assert(recognition.includes(marker), `English-expected recognition is missing ${marker}.`);
}
const openAi = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
assert(openAi.includes('include[]') && openAi.includes('logprobs'), 'Transcription log probabilities are not requested.');
assert(openAi.includes('writePart(output, boundary, "temperature", "0")'), 'Deterministic transcription temperature is missing.');
assert(openAi.includes('writePart(output, boundary, "language", language)'), 'Explicit source language is not sent to transcription.');
const bridge = read('local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java');
assert(bridge.includes('transcriptionUncertain'), 'Bridge does not expose uncertain recognition.');
assert(bridge.includes('transcribeDetailed'), 'Bridge does not use detailed transcription confidence.');
const desktopMain = read('desktop-app/src/main.js');
assert(desktopMain.includes("reason: 'transcription-uncertain'"), 'Interview Assistant does not ignore uncertain incoming text.');
const subtitleRenderer = read('desktop-app/src/subtitle-overlay-renderer.js');
assert(subtitleRenderer.includes('UNCERTAIN RECOGNITION') && subtitleRenderer.includes('НЕУВЕРЕННОЕ РАСПОЗНАВАНИЕ'), 'Subtitle uncertainty warning is missing.');
const install = read('INSTALL_DESKTOP_WINDOWS.cmd');
assert(install.includes('*Setup-x64.exe') && install.includes('/wait'), 'One-command local build and installation is missing.');
console.log('Stage 17 high-accuracy incoming transcription validation: OK');
