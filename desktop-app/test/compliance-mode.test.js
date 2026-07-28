const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExamComplianceModeEnabled,
  enforceExamComplianceSettings,
  complianceBlockedResult
} = require('../src/main/compliance-mode');
const { normalizeAssistantSettings } = require('../src/main/assistant-overlay');
const { normalizeSubtitleSettings } = require('../src/main/subtitle-overlay');

test('compliance mode forces assistant, teleprompter and capture protection off', () => {
  const enforced = enforceExamComplianceSettings({
    EXAM_COMPLIANCE_MODE: 'true',
    INTERVIEW_ASSISTANT_ENABLED: 'true',
    INTERVIEW_ASSISTANT_AUTO_ANALYZE: 'true',
    INTERVIEW_ASSISTANT_CONTENT_PROTECTION: 'true',
    INTERVIEW_TELEPROMPTER_ENABLED: 'true',
    INTERVIEW_TELEPROMPTER_AUTO_START: 'true',
    SUBTITLE_WINDOW_CONTENT_PROTECTION: 'true'
  });
  assert.equal(isExamComplianceModeEnabled(enforced), true);
  assert.equal(enforced.INTERVIEW_ASSISTANT_ENABLED, 'false');
  assert.equal(enforced.INTERVIEW_ASSISTANT_AUTO_ANALYZE, 'false');
  assert.equal(enforced.INTERVIEW_ASSISTANT_CONTENT_PROTECTION, 'false');
  assert.equal(enforced.INTERVIEW_TELEPROMPTER_ENABLED, 'false');
  assert.equal(enforced.INTERVIEW_TELEPROMPTER_AUTO_START, 'false');
  assert.equal(enforced.SUBTITLE_WINDOW_CONTENT_PROTECTION, 'false');
});

test('overlay normalization independently enforces compliance mode', () => {
  const source = {
    EXAM_COMPLIANCE_MODE: 'true',
    INTERVIEW_ASSISTANT_ENABLED: 'true',
    INTERVIEW_ASSISTANT_AUTO_ANALYZE: 'true',
    INTERVIEW_ASSISTANT_CONTENT_PROTECTION: 'true',
    INTERVIEW_TELEPROMPTER_ENABLED: 'true',
    SUBTITLE_WINDOW_CONTENT_PROTECTION: 'true'
  };
  const assistant = normalizeAssistantSettings(source, 'win32');
  const subtitles = normalizeSubtitleSettings(source, 'win32');
  assert.equal(assistant.complianceMode, true);
  assert.equal(assistant.enabled, false);
  assert.equal(assistant.autoAnalyze, false);
  assert.equal(assistant.contentProtection, false);
  assert.equal(assistant.teleprompterEnabled, false);
  assert.equal(subtitles.complianceMode, true);
  assert.equal(subtitles.contentProtection, false);
});

test('blocked result is explicit and machine-readable', () => {
  const result = complianceBlockedResult('Interview Assistant');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.complianceMode, true);
  assert.match(result.message, /disabled/i);
});
