const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_TEXT = 20000;
const MAX_RESUME_TEXT = 200000;
const MAX_FACTS = 300;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.json', '.txt', '.md']);

function cleanText(value, maxLength = MAX_TEXT) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function uniqueLines(value, maxItems = 200) {
  const seen = new Set();
  const result = [];
  const source = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  for (const raw of source) {
    const text = cleanText(raw, 1000);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function createFact(value, index = 0) {
  const source = value && typeof value === 'object' ? value : { text: value };
  const text = cleanText(source.text, 2000);
  if (!text) return null;
  return {
    id: cleanText(source.id, 128) || crypto.createHash('sha256').update(`${text}|${index}`).digest('hex').slice(0, 20),
    text,
    category: cleanText(source.category, 80) || 'general',
    source: cleanText(source.source, 240) || 'manual',
    confirmed: source.confirmed !== false,
    locked: source.locked === true,
    createdAt: cleanText(source.createdAt, 64) || new Date().toISOString()
  };
}

function defaultProfile() {
  return {
    schemaVersion: SCHEMA_VERSION,
    fullName: '',
    targetRole: '',
    location: '',
    professionalSummary: '',
    skills: [],
    languages: [],
    experience: '',
    projects: '',
    education: '',
    resumeText: '',
    resumeSource: '',
    confirmedFacts: [],
    updatedAt: ''
  };
}

function sanitizeProfile(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const facts = [];
  const rawFacts = Array.isArray(source.confirmedFacts)
    ? source.confirmedFacts
    : uniqueLines(source.confirmedFacts, MAX_FACTS).map(text => ({ text }));
  for (let index = 0; index < rawFacts.length && facts.length < MAX_FACTS; index += 1) {
    const fact = createFact(rawFacts[index], index);
    if (fact) facts.push(fact);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    fullName: cleanText(source.fullName, 200),
    targetRole: cleanText(source.targetRole, 240),
    location: cleanText(source.location, 240),
    professionalSummary: cleanText(source.professionalSummary, MAX_TEXT),
    skills: uniqueLines(source.skills, 200),
    languages: uniqueLines(source.languages, 80),
    experience: cleanText(source.experience, MAX_TEXT),
    projects: cleanText(source.projects, MAX_TEXT),
    education: cleanText(source.education, MAX_TEXT),
    resumeText: cleanText(source.resumeText, MAX_RESUME_TEXT),
    resumeSource: cleanText(source.resumeSource, 1024),
    confirmedFacts: facts,
    updatedAt: cleanText(source.updatedAt, 64) || new Date().toISOString()
  };
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return { profile: defaultProfile(), recovered: false, warning: '' };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { profile: sanitizeProfile(parsed), recovered: false, warning: '' };
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(filePath, corruptPath); } catch (_) {}
    return {
      profile: defaultProfile(),
      recovered: true,
      warning: `Candidate profile was unreadable and was moved to ${corruptPath}: ${error.message}`
    };
  }
}

function createCandidateProfileStore({ profilePath }) {
  if (!profilePath) throw new TypeError('profilePath is required.');

  function load() {
    const result = readJsonSafe(profilePath);
    return { ok: true, path: profilePath, ...result };
  }

  function save(input) {
    const profile = sanitizeProfile(input);
    writeJsonAtomic(profilePath, profile);
    return { ok: true, path: profilePath, profile };
  }

  function reset() {
    const profile = defaultProfile();
    writeJsonAtomic(profilePath, profile);
    return { ok: true, path: profilePath, profile };
  }

  function importFromPath(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      throw new Error('Supported resume imports are JSON, TXT and MD in this stage.');
    }
    if (extension === '.json') {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const profile = sanitizeProfile(parsed);
      profile.resumeSource = filePath;
      return { ok: true, kind: 'profile-json', filePath, profile };
    }
    const resumeText = cleanText(fs.readFileSync(filePath, 'utf8'), MAX_RESUME_TEXT);
    const current = load().profile;
    return {
      ok: true,
      kind: 'resume-text',
      filePath,
      profile: sanitizeProfile({ ...current, resumeText, resumeSource: filePath })
    };
  }

  function exportToPath(filePath, input) {
    const profile = sanitizeProfile(input);
    writeJsonAtomic(filePath, profile);
    return { ok: true, filePath, profile };
  }

  return { load, save, reset, importFromPath, exportToPath, profilePath };
}

module.exports = {
  SCHEMA_VERSION,
  SUPPORTED_IMPORT_EXTENSIONS,
  cleanText,
  uniqueLines,
  defaultProfile,
  sanitizeProfile,
  writeJsonAtomic,
  readJsonSafe,
  createCandidateProfileStore
};
