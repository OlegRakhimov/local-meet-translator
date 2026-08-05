'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function versionAtLeast(actual, minimum) {
  const a = String(actual || '').split('.').map(Number);
  const b = String(minimum || '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(versionAtLeast(pkg.version, '1.0.23'), `Desktop version must be 1.0.23 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage12-3-runtime-routing.js'), 'Stage 12.3 validator is not wired into npm test.');

for (const extension of ['chrome-extension', 'edge-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.4'), `${extension}: expected version 1.7.4 or newer`);
  const offscreen = read(`${extension}/offscreen.js`);
  assert(offscreen.includes('const OFFSCREEN_MESSAGE_TYPES = new Set(['), `${extension}: offscreen message allowlist is missing`);
  assert(offscreen.includes('if (!msg || !OFFSCREEN_MESSAGE_TYPES.has(String(msg.type || "")))'), `${extension}: unknown runtime messages are not rejected before the async handler`);
  assert(offscreen.includes('return false;'), `${extension}: offscreen document does not yield unrelated runtime messages to background.js`);
  assert(offscreen.includes('"OFFSCREEN_ACTIVATE"'), `${extension}: activate message is missing from allowlist`);
  assert(offscreen.includes('"OFFSCREEN_STATUS"'), `${extension}: status message is missing from allowlist`);
}

console.log('Stage 12.3 runtime message routing validation: OK');
