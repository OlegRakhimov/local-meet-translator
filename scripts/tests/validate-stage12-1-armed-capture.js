const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const pkg = JSON.parse(read('desktop-app/package.json'));
const versionAtLeast = (actual, minimum) => {
  const a = String(actual || '').split('.').map(Number);
  const b = String(minimum || '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
};
assert(versionAtLeast(pkg.version, '1.0.21'), `Expected desktop 1.0.21 or newer, got ${pkg.version}`);

for (const extension of ['chrome-extension', 'edge-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.2'), `${extension}: expected 1.7.2 or newer`);
  const background = read(`${extension}/background.js`);
  const offscreen = read(`${extension}/offscreen.js`);
  const content = read(`${extension}/content_script.js`);
  assert(background.includes('armTabCapture(tabId)'), `${extension}: popup arming controller is missing`);
  assert(background.includes('OFFSCREEN_ARM'), `${extension}: offscreen arm command is missing`);
  assert(background.includes('OFFSCREEN_ACTIVATE'), `${extension}: armed activation is missing`);
  assert(background.includes('OFFSCREEN_PAUSE'), `${extension}: pause-with-arm is missing`);
  assert(background.includes('msg.action === "release"'), `${extension}: shutdown release action is missing`);
  assert(offscreen.includes('Meeting tab audio is armed locally'), `${extension}: armed offscreen state is missing`);
  assert(offscreen.includes('OFFSCREEN_STATUS'), `${extension}: offscreen state recovery is missing`);
  assert(offscreen.includes('10 * 60 * 1000'), `${extension}: idle capture auto-release is missing`);
  assert(content.includes('32000'), `${extension}: content command timeout is too short`);
}

const main = read('desktop-app/src/main.js');
assert(main.includes("issueExtensionCommand('release', stopTarget)"), 'desktop shutdown must release armed browser audio');
assert(/waitForExtensionAck\(cmd\.seq,\s*(?:2[6-9]\d{3}|[3-9]\d{4,})\)/.test(main), 'desktop start ACK timeout was not increased');
console.log('Stage 12.1 user-gesture audio arming validation: OK');
