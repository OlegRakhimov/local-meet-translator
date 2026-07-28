const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  normalizeExtractedText,
  extractDocxTextFromBuffer,
  createDocumentTextExtractor
} = require('../src/main/document-text-extractor');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries, { deflate = false } = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressedData = deflate ? zlib.deflateRawSync(data) : data;
    const compressionMethod = deflate ? 8 : 0;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedData.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedData.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + compressedData.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

test('DOCX extractor reads paragraphs, tables and XML entities locally', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>Oleg &amp; Team</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Kotlin</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Flutter</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  const docx = createZip([['word/document.xml', xml]]);
  const text = extractDocxTextFromBuffer(docx);
  assert.match(text, /Oleg & Team/);
  assert.match(text, /Kotlin/);
  assert.match(text, /Flutter/);
});


test('DOCX extractor supports normal deflate-compressed Office XML entries', () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Compressed DOCX resume</w:t></w:r></w:p></w:body></w:document>';
  const docx = createZip([['word/document.xml', xml]], { deflate: true });
  assert.match(extractDocxTextFromBuffer(docx), /Compressed DOCX resume/);
});

test('PDF extractor invokes local pdftotext without uploading the document', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-doc-extractor-'));
  try {
    const filePath = path.join(directory, 'resume.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4\n', 'utf8');
    const calls = [];
    const extractor = createDocumentTextExtractor({
      resourcesRoot: directory,
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: Buffer.from('Jane Doe\nAndroid Developer\n', 'utf8'), stderr: '' };
      }
    });
    const result = await extractor.extractFromPath(filePath);
    assert.equal(result.format, 'pdf');
    assert.match(result.text, /Android Developer/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.at(-1), '-');
    assert.equal(calls[0].args.includes(filePath), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('normalization removes NULs and excessive blank lines', () => {
  assert.equal(normalizeExtractedText('\u0000A\r\n\r\n\r\n\r\nB  \n'), 'A\n\n\nB');
});
