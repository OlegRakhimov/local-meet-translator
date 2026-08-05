const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function isVersionAtLeast(actual, minimum) {
  const actualParts = String(actual || '').split('.').map(Number);
  const minimumParts = String(minimum || '').split('.').map(Number);
  if (actualParts.length !== 3 || minimumParts.length !== 3) return false;
  if (actualParts.some(value => !Number.isInteger(value)) || minimumParts.some(value => !Number.isInteger(value))) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] !== minimumParts[index]) return actualParts[index] > minimumParts[index];
  }
  return true;
}

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(isVersionAtLeast(pkg.version, '1.0.19'), 'Desktop version must be 1.0.19 or newer.');
assert(pkg.scripts['test:architecture'].includes('validate-stage11-1-reliable-start.js'), 'Reliable-start validator is not in test:architecture.');

const main = read('desktop-app/src/main.js');
assert(main.includes('extensionPollHeartbeat'), 'Desktop must track real extension command polling.');
assert(main.includes('waitForExtensionPoll'), 'Desktop must wait for the meeting command worker.');
assert(main.includes('Retrying once with a new command sequence'), 'Desktop start command must retry once.');
assert(main.includes("state:'voice-timeout'"), 'Missing confirmed voice timeout state.');
assert(main.includes("state:'subtitle-timeout'"), 'Missing confirmed subtitle timeout state.');
assert(!main.includes('Treating it as started because the tab is connected'), 'Desktop must not report unconfirmed capture as running.');
assert(main.includes('Browser audio capture confirmed released before desktop shutdown.') || main.includes('Browser audio capture confirmed stopped before desktop shutdown.'), 'Desktop close must wait for browser capture release confirmation.');

const renderer = read('desktop-app/src/renderer.js');
assert(renderer.includes('reportTranslationStartResult'), 'Renderer must surface start failures.');
assert(renderer.includes('[START FAILED]'), 'Renderer must log explicit start failures.');

for (const dir of ['edge-extension', 'chrome-extension']) {
  const manifest = JSON.parse(read(`${dir}/manifest.json`));
  assert(isVersionAtLeast(manifest.version, '1.7.0'), `${dir} version must be 1.7.0 or newer.`);

  const background = read(`${dir}/background.js`);
  assert(background.includes('restartContentPolling'), `${dir} must restart content polling on connect.`);
  assert(background.includes('getTabStreamIdWithTimeout'), `${dir} must time out tab capture permission.`);
  assert(background.includes('Meeting tab connected, command polling is active, and browser audio is armed locally.') || background.includes('Meeting tab connected and command polling is active.'), `${dir} must verify command polling.`);

  const content = read(`${dir}/content_script.js`);
  assert(content.includes('__LMT_CONTENT_SCRIPT_CONTROLLER__'), `${dir} content script must be reinjectable.`);
  assert(content.includes('LMT_RESTART_POLLING'), `${dir} content script must support explicit restart.`);
  assert(content.includes('Browser audio start/stop operation timed out.'), `${dir} command execution needs a watchdog.`);
  assert(content.includes('state.pollStartedAt > 25000') || content.includes('Date.now() - state.pollStartedAt > 25000'), `${dir} poll loop needs stale-busy recovery.`);
}

console.log('Stage 11.1 reliable translation start validation: OK');
