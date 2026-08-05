const INTERVIEW_PROFILE_MODES = Object.freeze({
  GENERAL: 'general',
  SPEAKIT_POLISH_SUPPORT: 'speakit_polish_support'
});

const SUPPORTED_PROFILE_MODES = new Set(Object.values(INTERVIEW_PROFILE_MODES));

function normalizeInterviewProfileMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SUPPORTED_PROFILE_MODES.has(normalized)
    ? normalized
    : INTERVIEW_PROFILE_MODES.GENERAL;
}

function interviewProfileDefinition(value) {
  const id = normalizeInterviewProfileMode(value);
  if (id === INTERVIEW_PROFILE_MODES.SPEAKIT_POLISH_SUPPORT) {
    return Object.freeze({
      id,
      label: 'SpeakIT — Polish Customer Support',
      candidateProfileFile: 'candidate-profile-speakit-polish-support.json',
      answerLibraryFile: 'answer-library-speakit-polish-support.json',
      presetDirectory: 'speakit-polish-support'
    });
  }
  return Object.freeze({
    id: INTERVIEW_PROFILE_MODES.GENERAL,
    label: 'General interview assistant',
    candidateProfileFile: 'candidate-profile.json',
    answerLibraryFile: 'answer-library.json',
    presetDirectory: ''
  });
}

module.exports = {
  INTERVIEW_PROFILE_MODES,
  SUPPORTED_PROFILE_MODES,
  normalizeInterviewProfileMode,
  interviewProfileDefinition
};
