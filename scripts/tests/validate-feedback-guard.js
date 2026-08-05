const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const files = [
  path.join(root, 'edge-extension', 'offscreen.js'),
  path.join(root, 'chrome-extension', 'offscreen.js')
];

function assert(condition, message) {
  if (!condition) {
    console.error(`Feedback guard validation failed: ${message}`);
    process.exit(1);
  }
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  assert(text.includes('blockMicForOwnTts()'), `${file}: own-TTS microphone blocking is missing`);
  assert(text.includes('stopAndDiscardCurrentMicSegment'), `${file}: active mic segment discard is missing`);
  assert(!text.includes('REMOTE_AUDIO_BLOCK_THRESHOLD'), `${file}: remote-audio hard gate must stay disabled`);
  assert(text.includes('MIC_NOISE_START_MULTIPLIER'), `${file}: adaptive microphone VAD is missing`);
  assert(text.includes('MIC_MIN_SPEECH_RATIO'), `${file}: speech-ratio validation is missing`);
  assert(text.includes('recentMicHistory'), `${file}: outgoing transcript history dedupe is missing`);
  assert(text.includes('recentSpokenHistory'), `${file}: spoken translation history dedupe is missing`);
  assert(text.includes('TTS playback timed out.'), `${file}: TTS playback must keep the outgoing pipeline serialized until audio ends`);
  assert(text.includes('autoGainControl: true'), `${file}: microphone auto-gain must be enabled for low-level physical microphones`);
}

console.log('Feedback guard validation passed.');
