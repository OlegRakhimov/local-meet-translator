const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 3;
const MAX_ENTRIES = 500;
const MAX_TEXT = 20000;
const LEVELS = new Set(['A2', 'B1', 'B2']);
const STYLES = new Set(['simple', 'technical', 'star', 'general']);

function cleanText(value, maxLength = MAX_TEXT) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function uniqueLines(value, maxItems = 100) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const seen = new Set();
  const result = [];
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

function createEntryId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeEntry(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();
  const level = cleanText(source.level, 8).toUpperCase();
  const style = cleanText(source.style, 32).toLowerCase();
  const id = cleanText(source.id, 128) || createEntryId();
  return {
    id,
    question: cleanText(source.question, 4000),
    aliases: uniqueLines(source.aliases, 120),
    intent: cleanText(source.intent, 240),
    level: LEVELS.has(level) ? level : 'B1',
    style: STYLES.has(style) ? style : 'simple',
    answer: cleanText(source.answer, MAX_TEXT),
    firstSentence: cleanText(source.firstSentence, 2000),
    keywords: uniqueLines(source.keywords, 80),
    usefulPhrases: uniqueLines(source.usefulPhrases, 80),
    groundingFacts: uniqueLines(source.groundingFacts, 150),
    locked: source.locked === true,
    createdAt: cleanText(source.createdAt, 64) || now,
    updatedAt: cleanText(source.updatedAt, 64) || now,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index
  };
}

function defaultLibrary() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profileMode: 'general',
    presetRevision: 0,
    entries: [],
    updatedAt: ''
  };
}

function sanitizeLibrary(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const entries = [];
  const ids = new Set();
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  for (let index = 0; index < rawEntries.length && entries.length < MAX_ENTRIES; index += 1) {
    const entry = sanitizeEntry(rawEntries[index], index);
    if (!entry.question && !entry.answer) continue;
    if (ids.has(entry.id)) entry.id = createEntryId();
    ids.add(entry.id);
    entries.push(entry);
  }
  entries.sort((a, b) => (a.order - b.order) || a.question.localeCompare(b.question));
  return {
    schemaVersion: SCHEMA_VERSION,
    profileMode: cleanText(source.profileMode, 80).toLowerCase() || 'general',
    presetRevision: Number.isFinite(Number(source.presetRevision))
      ? Math.max(0, Math.floor(Number(source.presetRevision)))
      : 0,
    entries,
    updatedAt: cleanText(source.updatedAt, 64) || new Date().toISOString()
  };
}

function syncBundledPreset(currentInput, presetInput) {
  const current = sanitizeLibrary(currentInput);
  const preset = sanitizeLibrary(presetInput);
  if (!preset.entries.length || preset.presetRevision <= current.presetRevision) {
    return { library: current, updated: false };
  }

  const presetById = new Map(preset.entries.map(entry => [entry.id, entry]));
  const customEntries = current.entries.filter(entry => !presetById.has(entry.id));
  const library = sanitizeLibrary({
    ...current,
    profileMode: preset.profileMode || current.profileMode,
    presetRevision: preset.presetRevision,
    entries: [...preset.entries, ...customEntries],
    updatedAt: preset.updatedAt || new Date().toISOString()
  });
  return { library, updated: true };
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readJsonSafe(filePath, fallbackLibrary = defaultLibrary()) {
  const fallback = sanitizeLibrary(fallbackLibrary);
  if (!fs.existsSync(filePath)) return { library: fallback, recovered: false, warning: '' };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { library: sanitizeLibrary(parsed), recovered: false, warning: '' };
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(filePath, corruptPath); } catch (_) {}
    return {
      library: fallback,
      recovered: true,
      warning: `Answer library was unreadable and was moved to ${corruptPath}: ${error.message}`
    };
  }
}

function createAnswerLibraryStore({ libraryPath, presetLibrary = null }) {
  if (!libraryPath) throw new TypeError('libraryPath is required.');
  const initialLibrary = sanitizeLibrary(presetLibrary || defaultLibrary());

  function load() {
    const result = readJsonSafe(libraryPath, initialLibrary);
    const synced = presetLibrary
      ? syncBundledPreset(result.library, initialLibrary)
      : { library: result.library, updated: false };
    if (synced.updated) writeJsonAtomic(libraryPath, synced.library);
    return {
      ok: true,
      path: libraryPath,
      ...result,
      library: synced.library,
      presetUpdated: synced.updated
    };
  }

  function save(input) {
    const library = sanitizeLibrary(input);
    writeJsonAtomic(libraryPath, library);
    return { ok: true, path: libraryPath, library };
  }

  function reset() {
    const library = sanitizeLibrary(initialLibrary);
    writeJsonAtomic(libraryPath, library);
    return { ok: true, path: libraryPath, library };
  }

  function importFromPath(filePath) {
    if (path.extname(String(filePath || '')).toLowerCase() !== '.json') {
      throw new Error('Answer Library import supports JSON only.');
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ok: true, filePath, library: sanitizeLibrary(parsed) };
  }

  function exportToPath(filePath, input) {
    const library = sanitizeLibrary(input);
    writeJsonAtomic(filePath, library);
    return { ok: true, filePath, library };
  }

  return { load, save, reset, importFromPath, exportToPath, libraryPath };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_ENTRIES,
  LEVELS,
  STYLES,
  cleanText,
  uniqueLines,
  sanitizeEntry,
  defaultLibrary,
  sanitizeLibrary,
  syncBundledPreset,
  writeJsonAtomic,
  readJsonSafe,
  createAnswerLibraryStore
};
