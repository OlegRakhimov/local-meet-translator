const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assertIncludes = (text, value, label) => {
  if (!text.includes(value)) throw new Error(`${label} is missing: ${value}`);
};

function isVersionAtLeast(actual, minimum) {
  const actualParts = String(actual || '').split('.').map(Number);
  const minimumParts = String(minimum || '').split('.').map(Number);
  if (actualParts.length !== 3 || minimumParts.length !== 3) return false;
  if (actualParts.some(value => !Number.isInteger(value)) || minimumParts.some(value => !Number.isInteger(value))) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] !== minimumParts[index]) return actualParts[index] > minimumParts[index];
  }
  return true;
}

const main = read('desktop-app/src/main.js');
const preload = read('desktop-app/src/preload.js');
const renderer = read('desktop-app/src/renderer.js');
const html = read('desktop-app/src/index.html');
const store = read('desktop-app/src/main/live-interview-store.js');
const pkg = JSON.parse(read('desktop-app/package.json'));

if (!isVersionAtLeast(pkg.version, '1.0.14')) throw new Error(`Expected desktop version 1.0.14 or newer, got ${pkg.version}`);
assertIncludes(main, "createLiveInterviewStore", 'Main process live interview store');
for (const channel of ['live-interview:load','live-interview:start','live-interview:end','live-interview:update','live-interview:reset','live-interview:export']) {
  assertIncludes(main, channel, 'Main process IPC');
}
assertIncludes(main, "liveInterviewStore.recordQuestion(question)", 'Automatic question recording');
assertIncludes(main, "liveInterviewStore.recordSuggestion(questionText, suggestion)", 'Automatic suggestion recording');
for (const method of ['liveInterviewLoad','liveInterviewStart','liveInterviewEnd','liveInterviewUpdate','liveInterviewReset','liveInterviewExport','onLiveInterviewState']) {
  assertIncludes(preload, method, 'Preload API');
}
for (const id of ['postSessionReviewScreen','startLiveSession','endLiveSession','postSessionQuestionList','savePostSessionReview','resetPostSessionHistory']) {
  assertIncludes(html, `id="${id}"`, 'Stage 8 HTML control');
}
for (const symbol of ['loadLiveInterviews','startLiveInterviewSession','endLiveInterviewSession','savePostSessionReview','renderPostSessionEditor']) {
  assertIncludes(renderer, symbol, 'Stage 8 renderer logic');
}
if (/audio(Data|Bytes|Base64)|rawAudio|wavPath|mp3Path/i.test(store)) {
  throw new Error('Live interview history store must not persist raw audio fields.');
}
if (/openai|requestJsonPost|transcrib/i.test(store)) {
  throw new Error('Post-session store must remain local and must not call OpenAI or transcription services.');
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);
console.log('Stage 8 post-session review architecture: OK');
