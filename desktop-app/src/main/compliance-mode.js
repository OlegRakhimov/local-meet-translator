const COMPLIANCE_CONTROLLED_SETTINGS = Object.freeze([
  'INTERVIEW_ASSISTANT_ENABLED',
  'INTERVIEW_ASSISTANT_AUTO_ANALYZE',
  'INTERVIEW_ASSISTANT_CONTENT_PROTECTION',
  'INTERVIEW_TELEPROMPTER_ENABLED',
  'INTERVIEW_TELEPROMPTER_AUTO_START',
  'SUBTITLE_WINDOW_CONTENT_PROTECTION'
]);

function boolValue(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isExamComplianceModeEnabled(settings = {}) {
  return boolValue(settings.EXAM_COMPLIANCE_MODE ?? settings.examComplianceMode, false);
}

function enforceExamComplianceSettings(settings = {}) {
  const source = { ...(settings || {}) };
  const enabled = isExamComplianceModeEnabled(source);
  source.EXAM_COMPLIANCE_MODE = enabled ? 'true' : 'false';
  if (!enabled) return source;
  const enforced = { ...source };
  for (const key of COMPLIANCE_CONTROLLED_SETTINGS) enforced[key] = 'false';
  return enforced;
}

function complianceBlockedResult(feature = 'This function') {
  return {
    ok: false,
    blocked: true,
    complianceMode: true,
    message: `${feature} is disabled while Exam compliance mode is active.`
  };
}

module.exports = {
  COMPLIANCE_CONTROLLED_SETTINGS,
  boolValue,
  isExamComplianceModeEnabled,
  enforceExamComplianceSettings,
  complianceBlockedResult
};
