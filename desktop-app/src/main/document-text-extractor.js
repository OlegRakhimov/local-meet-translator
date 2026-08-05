const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);

function normalizeExtractedText(value, maxLength = 200000) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxLength);
}

function assertReadableDocument(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('The selected document is not a regular file.');
  if (stat.size <= 0) throw new Error('The selected document is empty.');
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`The selected document is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`);
  }
  return { resolved, stat };
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('DOCX ZIP directory was not found.');
}

function readDocxZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('DOCX file is incomplete.');
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) throw new Error('DOCX ZIP directory is invalid.');

  const entries = new Map();
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('DOCX ZIP entry is invalid.');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error('DOCX ZIP filename is invalid.');
    const encoding = (flags & 0x0800) ? 'utf8' : 'latin1';
    const name = buffer.subarray(nameStart, nameEnd).toString(encoding).replace(/\\/g, '/');

    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`DOCX entry is too large: ${name}`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) throw new Error('DOCX expands beyond the safe extraction limit.');

    entries.set(name, { name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function inflateDocxEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`DOCX local ZIP header is invalid: ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error(`DOCX ZIP data is truncated: ${entry.name}`);
  const compressed = buffer.subarray(dataStart, dataEnd);
  let output;
  if (entry.compressionMethod === 0) output = Buffer.from(compressed);
  else if (entry.compressionMethod === 8) output = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
  else throw new Error(`Unsupported DOCX ZIP compression method ${entry.compressionMethod}.`);
  if (output.length > MAX_ZIP_ENTRY_BYTES) throw new Error(`DOCX entry is too large after extraction: ${entry.name}`);
  return output;
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function wordXmlToText(xml) {
  const prepared = String(xml || '')
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/w:tc\s*>/gi, '\t')
    .replace(/<\/w:tr\s*>/gi, '\n')
    .replace(/<\/w:p\s*>/gi, '\n')
    .replace(/<w:noBreakHyphen\b[^>]*\/?\s*>/gi, '-')
    .replace(/<w:softHyphen\b[^>]*\/?\s*>/gi, '\u00ad')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(prepared);
}

function extractDocxTextFromBuffer(buffer) {
  const entries = readDocxZipEntries(buffer);
  if (!entries.has('word/document.xml')) throw new Error('The DOCX document body was not found.');
  const names = Array.from(entries.keys())
    .filter(name => /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i.test(name))
    .sort((left, right) => {
      if (left === 'word/document.xml') return -1;
      if (right === 'word/document.xml') return 1;
      return left.localeCompare(right);
    });
  const sections = [];
  for (const name of names) {
    const xml = inflateDocxEntry(buffer, entries.get(name)).toString('utf8');
    const text = normalizeExtractedText(wordXmlToText(xml), MAX_EXTRACTED_BYTES);
    if (text) sections.push(text);
  }
  const result = normalizeExtractedText(sections.join('\n\n'));
  if (!result) throw new Error('The DOCX file contains no extractable text.');
  return result;
}

function runProcess(command, args, { timeoutMs = 30000, maxOutputBytes = MAX_EXTRACTED_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutLength = 0;
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, { windowsHide: true, shell: false });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_) {}
      reject(Object.assign(new Error('Document extraction timed out.'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdoutLength += chunk.length;
      if (stdoutLength > maxOutputBytes) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { child.kill(); } catch (_) {}
          reject(new Error('Extracted document text exceeds the safe size limit.'));
        }
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on('data', chunk => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(Buffer.from(chunk));
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(Object.assign(new Error(errorText || `Document extraction failed with exit code ${code}.`), { exitCode: code }));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText });
    });
  });
}

function pdfToolCandidates(resourcesRoot) {
  const executable = process.platform === 'win32' ? 'pdftotext.exe' : 'pdftotext';
  const root = path.resolve(resourcesRoot || process.resourcesPath || process.cwd());
  const direct = [
    path.join(root, 'document-tools', 'poppler', executable),
    path.join(root, 'document-tools', executable)
  ];
  return [...direct.filter(candidate => fs.existsSync(candidate)), executable];
}

async function extractPdfText(filePath, { resourcesRoot, run = runProcess } = {}) {
  const errors = [];
  for (const command of pdfToolCandidates(resourcesRoot)) {
    try {
      const result = await run(command, ['-layout', '-enc', 'UTF-8', '-nopgbrk', filePath, '-']);
      const text = normalizeExtractedText(result.stdout.toString('utf8'));
      if (!text) {
        throw new Error('The PDF contains no extractable text. Scanned image PDFs require OCR, which is not enabled.');
      }
      return text;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push(`${command}: not found`);
        continue;
      }
      errors.push(`${command}: ${error.message || String(error)}`);
      if (path.isAbsolute(command)) continue;
    }
  }
  throw new Error(`PDF import requires the bundled Poppler pdftotext tool. ${errors.join(' | ')}`);
}

function createDocumentTextExtractor({ resourcesRoot, run = runProcess } = {}) {
  async function extractFromPath(filePath) {
    const { resolved } = assertReadableDocument(filePath);
    const extension = path.extname(resolved).toLowerCase();
    if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new Error('Supported resume documents are TXT, MD, PDF and DOCX.');
    }
    if (extension === '.txt' || extension === '.md') {
      const text = normalizeExtractedText(fs.readFileSync(resolved, 'utf8'));
      if (!text) throw new Error('The selected text document contains no readable text.');
      return { text, format: extension.slice(1), filePath: resolved };
    }
    if (extension === '.docx') {
      return { text: extractDocxTextFromBuffer(fs.readFileSync(resolved)), format: 'docx', filePath: resolved };
    }
    return { text: await extractPdfText(resolved, { resourcesRoot, run }), format: 'pdf', filePath: resolved };
  }
  return { extractFromPath };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_BYTES,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  normalizeExtractedText,
  readDocxZipEntries,
  extractDocxTextFromBuffer,
  extractPdfText,
  createDocumentTextExtractor
};
