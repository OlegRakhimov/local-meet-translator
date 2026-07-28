'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(pkg.version === '1.0.29', 'Desktop version must be 1.0.29.');
assert(String(pkg.scripts?.['test:architecture'] || '').includes('validate-stage16-document-compliance-release.js'), 'Stage 16 validator must be wired into npm test.');
assert((pkg.build?.extraResources || []).some(item => item.from === '../document-tools/poppler' && item.to === 'document-tools/poppler'), 'Bundled Poppler resource is missing.');

const extractor = read('desktop-app/src/main/document-text-extractor.js');
for (const marker of ['extractDocxTextFromBuffer', 'pdftotext', "shell: false", 'Scanned image PDFs require OCR']) {
  assert(extractor.includes(marker), `Document extractor is missing: ${marker}`);
}
const profileStore = read('desktop-app/src/main/candidate-profile-store.js');
assert(profileStore.includes("'.pdf'") && profileStore.includes("'.docx'"), 'Candidate profile import must accept PDF and DOCX.');
assert(profileStore.includes('extractDocumentText'), 'Candidate profile store must use the document extractor.');

const compliance = read('desktop-app/src/main/compliance-mode.js');
for (const setting of [
  'INTERVIEW_ASSISTANT_ENABLED',
  'INTERVIEW_ASSISTANT_AUTO_ANALYZE',
  'INTERVIEW_ASSISTANT_CONTENT_PROTECTION',
  'INTERVIEW_TELEPROMPTER_ENABLED',
  'INTERVIEW_TELEPROMPTER_AUTO_START',
  'SUBTITLE_WINDOW_CONTENT_PROTECTION'
]) {
  assert(compliance.includes(setting), `Compliance mode does not enforce ${setting}.`);
}
const main = read('desktop-app/src/main.js');
assert(main.includes('examComplianceModeActive()'), 'Main process compliance guard is missing.');
assert(main.includes("url.pathname === '/extension-client/armed'"), 'Extension armed endpoint is missing.');
assert(main.includes('const visible = data.visible !== false'), 'DESKTOP_BLUR_STATE visibility is not consumed by desktop.');
assert(main.includes('extensionClientRegistry.clearActive(client.id)'), 'Blurred active client is not cleared.');


const edgeContent = read('edge-extension/content_script.js');
for (const marker of ['DESKTOP_BLUR_STATE', 'document.hasFocus()', 'visibilitychange', 'pagehide', 'lastSeq: state.lastSeq']) {
  assert(edgeContent.includes(marker), `Edge visibility/sequence implementation is missing: ${marker}`);
}
const edgeBackground = read('edge-extension/background.js');
assert(edgeBackground.includes('msg?.type === "DESKTOP_BLUR_STATE"'), 'Edge background does not route DESKTOP_BLUR_STATE.');
assert(edgeBackground.includes('visible: msg.visible === undefined ? false : !!msg.visible'), 'Edge background does not preserve blur visibility.');

const registry = read('desktop-app/src/main/extension-state.js');
assert(registry.includes('Number(Boolean(b.visible)) - Number(Boolean(a.visible))'), 'Visible clients must have first selection priority.');
assert(registry.includes('if (armed && client.visible)'), 'Hidden armed clients must not become active.');
assert(registry.includes("this.activeClientId === id) this.activeClientId = ''"), 'Hidden active client must be cleared.');

const renderer = read('desktop-app/src/renderer.js');
assert(renderer.includes('syncComplianceModeUi'), 'Compliance-mode UI synchronization is missing.');
assert(renderer.includes('EXAM_COMPLIANCE_MODE'), 'Compliance setting is not persisted by renderer.');
assert(read('desktop-app/src/main/assistant-overlay.js').includes('!settings.enabled || settings.complianceMode'), 'Compliance mode must unregister assistant and teleprompter hotkeys.');

const build = read('scripts/desktop/build-windows-installer.ps1');
for (const marker of ['Stage-PdfToTextRuntime', 'PackagedPdfToText', 'documentImport', 'pdftotext.exe']) {
  assert(build.includes(marker), `Windows build is missing: ${marker}`);
}
assert(build.includes('Running the complete desktop unit and architecture test suite'), 'Windows release build must run npm test before packaging.');
const workflow = read('.github/workflows/windows-release.yml');
assert(workflow.includes('BUILD_DESKTOP_WINDOWS.cmd'), 'Windows CI does not invoke the verified release build.');
assert(workflow.includes('actions/upload-artifact@v4'), 'Windows CI does not publish build artifacts.');
assert(workflow.includes('choco install poppler'), 'Windows CI does not install the PDF extraction runtime.');

console.log('Stage 16 document import, compliance mode, visibility routing and release build validation: OK');
