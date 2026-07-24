const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const files = [
  path.join(root, 'edge-extension', 'background.js'),
  path.join(root, 'edge-extension', 'offscreen.js'),
  path.join(root, 'chrome-extension', 'background.js'),
  path.join(root, 'chrome-extension', 'offscreen.js')
];
const renderer = fs.readFileSync(path.join(root, 'desktop-app', 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop-app', 'src', 'main.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Voice mode switch validation failed: ${message}`);
    process.exit(1);
  }
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('background.js')) {
    assert(text.includes('OFFSCREEN_UPDATE_MODE'), `${file}: incremental mode update is missing`);
    assert(text.includes('updateRunningCaptureMode'), `${file}: running capture update helper is missing`);
    assert(text.includes('Offscreen audio operation timed out'), `${file}: offscreen timeout diagnostic is missing`);
  } else {
    assert(text.includes('async function updateRunningMode'), `${file}: offscreen mode updater is missing`);
    assert(text.includes('async function stopMicCaptureOnly'), `${file}: microphone-only stop is missing`);
    assert(text.includes('Enabling microphone for outgoing translation without restarting subtitles'), `${file}: voice update diagnostic is missing`);
  }
}

assert(renderer.includes("Switch to subtitles-only mode clicked."), 'voice disable must switch to subtitles without stopping tab capture');
assert(main.includes("state:'voice-timeout'"), 'desktop must not fake successful voice readiness when ACK is missing');
assert(main.includes('function waitForExtensionAck(seq, timeoutMs = 22000)'), 'voice readiness wait timeout must cover microphone/output initialization');

console.log('Voice mode switch validation passed.');
