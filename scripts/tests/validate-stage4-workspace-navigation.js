const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function requireText(relative, pattern, message) {
  assert(pattern.test(read(relative)), `${relative}: ${message}`);
}

const html = read('desktop-app/src/index.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);

requireText('desktop-app/src/index.html', /id="homeScreen"[\s\S]*data-view="home"/, 'home view is missing');
requireText('desktop-app/src/index.html', /id="candidateProfileScreen"[\s\S]*data-view="candidate-profile"/, 'candidate profile view is missing');
requireText('desktop-app/src/index.html', /id="answerLibraryScreen"[\s\S]*data-view="answer-library"/, 'Answer Library view is missing');
requireText('desktop-app/src/index.html', /id="openCandidateProfile"/, 'candidate profile navigation card is missing');
requireText('desktop-app/src/index.html', /id="openAnswerLibrary"/, 'Answer Library navigation card is missing');
requireText('desktop-app/src/index.html', /class="editorSection"/, 'collapsible profile sections are missing');
requireText('desktop-app/src/renderer.js', /function showView\(/, 'view navigation controller is missing');
requireText('desktop-app/src/renderer.js', /discardUnsavedProfileChanges/, 'profile unsaved-change guard is missing');
requireText('desktop-app/src/renderer.js', /discardUnsavedAnswerChanges/, 'Answer Library unsaved-change guard is missing');
requireText('desktop-app/src/main.js', /workspace:dirty-state/, 'main-process dirty state channel is missing');
requireText('desktop-app/src/main.js', /Unsaved interview workspace changes/, 'close confirmation is missing');
requireText('desktop-app/src/main.js', /answer-library:load/, 'Answer Library IPC is missing');
requireText('desktop-app/src/preload.js', /answerLibrarySave/, 'Answer Library preload API is missing');
requireText('desktop-app/src/main/answer-library-store.js', /writeJsonAtomic/, 'Answer Library atomic persistence is missing');
requireText('desktop-app/package.json', /"version": "1\.0\.10"/, 'desktop version is not 1.0.10');

console.log('Stage 4 workspace navigation validation: OK');
