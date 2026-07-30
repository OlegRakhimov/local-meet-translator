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
assert(versionAtLeast(pkg.version, '1.0.24'), `Desktop version must be 1.0.24 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage13-compact-overlays.js'), 'Stage 13 validator is not wired into npm test.');

const subtitleMain = read('desktop-app/src/main/subtitle-overlay.js');
const subtitleRenderer = read('desktop-app/src/subtitle-overlay-renderer.js');
const subtitleCss = read('desktop-app/src/subtitle-overlay.css');
const index = read('desktop-app/src/index.html');
const renderer = read('desktop-app/src/renderer.js');

assert(subtitleMain.includes('SUBTITLE_WINDOW_MINIMAL_MODE'), 'Minimal subtitle setting is missing.');
assert(subtitleRenderer.includes('const sameIdIndex = item.id'), 'Subtitle events are not upserted by stable id.');
assert(subtitleRenderer.includes("document.body.classList.toggle('minimalMode'"), 'Minimal subtitle CSS mode is not applied.');
assert(subtitleCss.includes('body.minimalMode .titlebar'), 'Text-only subtitle styling is missing.');
assert(index.includes('id="subtitleMinimalMode"'), 'Minimal subtitle checkbox is missing.');
assert(renderer.includes('SUBTITLE_WINDOW_MINIMAL_MODE'), 'Minimal subtitle setting is not persisted.');

const assistantMain = read('desktop-app/src/main/assistant-overlay.js');
const assistantRenderer = read('desktop-app/src/assistant-overlay-renderer.js');
const assistantCss = read('desktop-app/src/assistant-overlay.css');
const assistantHtml = read('desktop-app/src/assistant-overlay.html');

assert(assistantMain.includes('INTERVIEW_ASSISTANT_COMPACT_OVERLAY'), 'Compact assistant setting is missing.');
assert(assistantMain.includes('transparent: true'), 'Assistant BrowserWindow is not transparent.');
assert(assistantMain.includes('assistantWindow.setOpacity(1)'), 'Assistant text opacity is still reduced with the whole window.');
assert(assistantRenderer.includes("' compactOverlay'"), 'Compact assistant class is not rendered.');
assert(assistantRenderer.includes("remark: 'РЕПЛИКА'"), 'Utterance feed labels are not explained in Russian.');
assert(assistantCss.includes('.assistantRoot.compactOverlay'), 'Compact transparent assistant styling is missing.');
assert(assistantHtml.includes('id="liveContextFeed"'), 'The general interviewer utterance feed is missing.');
assert(assistantHtml.includes('id="modeBadge"'), 'The explicit assistant mode indicator is missing.');
assert(index.includes('id="assistantCompactOverlay"'), 'Compact assistant checkbox is missing.');
assert(renderer.includes('INTERVIEW_ASSISTANT_COMPACT_OVERLAY'), 'Compact assistant setting is not persisted.');

console.log('Stage 13 compact overlays and subtitle idempotency validation: OK');
