const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeProfile,
  createCandidateProfileStore
} = require('../src/main/candidate-profile-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-profile-'));
}

test('sanitizes arrays and confirmed facts', () => {
  const profile = sanitizeProfile({
    fullName: ' Oleg ',
    skills: ['Kotlin', 'kotlin', 'Flutter'],
    confirmedFacts: [{ text: 'Published an Android app', confirmed: true, locked: true }]
  });
  assert.equal(profile.fullName, 'Oleg');
  assert.deepEqual(profile.skills, ['Kotlin', 'Flutter']);
  assert.equal(profile.confirmedFacts.length, 1);
  assert.equal(profile.confirmedFacts[0].confirmed, true);
  assert.equal(profile.confirmedFacts[0].locked, true);
});

test('saves and loads profile atomically', () => {
  const directory = tempDir();
  const profilePath = path.join(directory, 'candidate-profile.json');
  const store = createCandidateProfileStore({ profilePath });
  const saved = store.save({ fullName: 'Oleg', targetRole: 'Android Developer' });
  assert.equal(saved.ok, true);
  assert.equal(fs.existsSync(profilePath), true);
  const loaded = store.load();
  assert.equal(loaded.profile.fullName, 'Oleg');
  assert.equal(loaded.profile.targetRole, 'Android Developer');
});

test('imports text as reviewable resume content without inventing facts', async () => {
  const directory = tempDir();
  const profilePath = path.join(directory, 'candidate-profile.json');
  const resumePath = path.join(directory, 'resume.txt');
  fs.writeFileSync(resumePath, 'Kotlin developer with Android projects.\n', 'utf8');
  const store = createCandidateProfileStore({ profilePath });
  const imported = await store.importFromPath(resumePath);
  assert.equal(imported.kind, 'resume-text');
  assert.match(imported.profile.resumeText, /Kotlin developer/);
  assert.deepEqual(imported.profile.confirmedFacts, []);
});


test('imports PDF and DOCX through the configured local document extractor', async () => {
  const directory = tempDir();
  const profilePath = path.join(directory, 'candidate-profile.json');
  const resumePath = path.join(directory, 'resume.pdf');
  fs.writeFileSync(resumePath, '%PDF-1.4\n', 'utf8');
  const calls = [];
  const store = createCandidateProfileStore({
    profilePath,
    extractDocumentText: async filePath => {
      calls.push(filePath);
      return { text: 'Android developer with Kotlin and Flutter experience.', format: 'pdf' };
    }
  });
  const imported = await store.importFromPath(resumePath);
  assert.equal(imported.kind, 'resume-text');
  assert.equal(imported.format, 'pdf');
  assert.equal(calls.length, 1);
  assert.match(imported.profile.resumeText, /Kotlin and Flutter/);
  assert.deepEqual(imported.profile.confirmedFacts, []);
});

test('moves corrupt local profile aside and starts empty', () => {
  const directory = tempDir();
  const profilePath = path.join(directory, 'candidate-profile.json');
  fs.writeFileSync(profilePath, '{broken', 'utf8');
  const store = createCandidateProfileStore({ profilePath });
  const loaded = store.load();
  assert.equal(loaded.recovered, true);
  assert.equal(loaded.profile.fullName, '');
  assert.match(loaded.warning, /unreadable/i);
});
