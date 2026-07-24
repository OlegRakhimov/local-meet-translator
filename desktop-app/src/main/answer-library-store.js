const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
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
    intent: cleanText(source.intent, 240),
    level: LEVELS.has(level) ? level : 'B1',
    style: STYLES.has(style) ? style : 'simple',
    answer: cleanText(source.answer, MAX_TEXT),
    firstSentence: cleanText(source.firstSentence, 2000),
    keywords: uniqueLines(source.keywords, 80),
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
    entries,
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
  if (!fs.existsSync(filePath)) return { library: defaultLibrary(), recovered: false, warning: '' };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { library: sanitizeLibrary(parsed), recovered: false, warning: '' };
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(filePath, corruptPath); } catch (_) {}
    return {
      library: defaultLibrary(),
      recovered: true,
      warning: `Answer library was unreadable and was moved to ${corruptPath}: ${error.message}`
    };
  }
}

function createAnswerLibraryStore({ libraryPath }) {
  if (!libraryPath) throw new TypeError('libraryPath is required.');

  function load() {
    const result = readJsonSafe(libraryPath);
    return { ok: true, path: libraryPath, ...result };
  }

  function save(input) {
    const library = sanitizeLibrary(input);
    writeJsonAtomic(libraryPath, library);
    return { ok: true, path: libraryPath, library };
  }

  function reset() {
    const library = defaultLibrary();
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
  writeJsonAtomic,
  readJsonSafe,
  createAnswerLibraryStore
};
