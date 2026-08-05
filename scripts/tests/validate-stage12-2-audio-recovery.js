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
assert(versionAtLeast(pkg.version, '1.0.22'), `Desktop version must be 1.0.22 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage12-2-audio-recovery.js'), 'Stage 12.2 validator is not wired into npm test.');

const main = read('desktop-app/src/main.js');
assert(main.includes('waitForExtensionAck(cmd.seq, 32000)'), 'Desktop must allow enough time for automatic audio recovery.');

for (const extension of ['chrome-extension', 'edge-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.3'), `${extension}: expected version 1.7.3 or newer`);
  const background = read(`${extension}/background.js`);
  const offscreen = read(`${extension}/offscreen.js`);
  assert(background.includes('recoverArmedTabCapture'), `${extension}: automatic audio recovery is missing`);
  assert(background.includes('Browser audio was re-armed automatically'), `${extension}: recovery success status is missing`);
  assert(background.includes('Do not release merely because Meet reports a transient "loading" state.'), `${extension}: transient Meet loading still releases capture`);
  assert(!background.includes('if (changeInfo && changeInfo.status === "loading")'), `${extension}: obsolete loading-state release remains`);
  assert(offscreen.includes('The next desktop start will try to re-arm it automatically.'), `${extension}: ended-track state is not reported`);
}

console.log('Stage 12.2 automatic audio recovery validation: OK');
