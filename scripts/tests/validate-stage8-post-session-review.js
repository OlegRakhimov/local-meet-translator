const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assertIncludes = (text, value, label) => {
  if (!text.includes(value)) throw new Error(`${label} is missing: ${value}`);
};

const main = read('desktop-app/src/main.js');
const preload = read('desktop-app/src/preload.js');
const renderer = read('desktop-app/src/renderer.js');
const html = read('desktop-app/src/index.html');
const store = read('desktop-app/src/main/live-interview-store.js');
const pkg = JSON.parse(read('desktop-app/package.json'));

if (!['1.0.14', '1.0.15', '1.0.16'].includes(pkg.version)) throw new Error(`Expected desktop version 1.0.14, 1.0.15 or 1.0.16, got ${pkg.version}`);
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
