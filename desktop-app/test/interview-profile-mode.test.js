const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INTERVIEW_PROFILE_MODES,
  normalizeInterviewProfileMode,
  interviewProfileDefinition
} = require('../src/main/interview-profile-mode');

test('normalizes supported interview profile modes and falls back to general', () => {
  assert.equal(normalizeInterviewProfileMode('speakit_polish_support'), INTERVIEW_PROFILE_MODES.SPEAKIT_POLISH_SUPPORT);
  assert.equal(normalizeInterviewProfileMode(' SPEAKIT_POLISH_SUPPORT '), INTERVIEW_PROFILE_MODES.SPEAKIT_POLISH_SUPPORT);
  assert.equal(normalizeInterviewProfileMode('unknown'), INTERVIEW_PROFILE_MODES.GENERAL);
});

test('returns isolated storage files for the SpeakIT profile', () => {
  const definition = interviewProfileDefinition(INTERVIEW_PROFILE_MODES.SPEAKIT_POLISH_SUPPORT);
  assert.equal(definition.candidateProfileFile, 'candidate-profile-speakit-polish-support.json');
  assert.equal(definition.answerLibraryFile, 'answer-library-speakit-polish-support.json');
  assert.match(definition.label, /SpeakIT/);
});
