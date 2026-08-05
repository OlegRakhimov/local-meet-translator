const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const extensions = [
  { name: "chrome", dir: path.join(repoRoot, "chrome-extension") },
  { name: "edge", dir: path.join(repoRoot, "edge-extension") },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const { name, dir } of extensions) {
  const background = fs.readFileSync(path.join(dir, "background.js"), "utf8");
  const contentScript = fs.readFileSync(path.join(dir, "content_script.js"), "utf8");
  const popup = fs.readFileSync(path.join(dir, "popup.js"), "utf8");

  assert(!/127\.0\.0\.1:18798/.test(contentScript), `${name} content_script must not call localhost directly.`);
  assert(!/localhost:18798/.test(contentScript), `${name} content_script must not call localhost directly.`);
  assert(!/127\.0\.0\.1:18798/.test(popup), `${name} popup must not call localhost directly.`);
  assert(/\bX-Desktop-Extension-Token\b/.test(background), `${name} background must forward the desktop extension token.`);
  assert(/\bPAIR_WITH_DESKTOP\b/.test(background), `${name} background must implement pairing through the desktop app.`);
  assert(/\bDESKTOP_COMMAND_POLL\b/.test(background), `${name} background must own desktop command polling.`);
  assert(/\backDesktopCommand\b/.test(background), `${name} background must post desktop command acknowledgements.`);
  assert(/\bfinalizeDesktopCommandResult\b/.test(background), `${name} background must finalize command results and own ACK delivery.`);
  assert(/\bupdateDesktopCommandCursor\b/.test(background), `${name} background must persist the accepted command cursor.`);
  assert(!/\bsendCommandAck\b/.test(contentScript), `${name} content_script must not send desktop command acknowledgements.`);
  assert(!/type:\s*["']DESKTOP_COMMAND_ACK["']/.test(contentScript), `${name} content_script must not emit DESKTOP_COMMAND_ACK.`);
  assert(/\bPAIR_WITH_DESKTOP\b/.test(popup), `${name} popup must expose desktop pairing.`);
}


const desktopMain = fs.readFileSync(path.join(repoRoot, "desktop-app", "src", "main.js"), "utf8");
const coordinator = fs.readFileSync(path.join(repoRoot, "desktop-app", "src", "main", "extension-state.js"), "utf8");
assert(/if\s*\(\s*!ackResult\.duplicate\s*\)/.test(desktopMain), "Desktop ACK endpoint must suppress duplicate side effects and logs.");
assert(/duplicate:\s*true/.test(coordinator), "Desktop coordinator must return an idempotent duplicate ACK result.");

const chromeBackground = fs.readFileSync(path.join(repoRoot, "chrome-extension", "background.js"), "utf8");
const edgeBackground = fs.readFileSync(path.join(repoRoot, "edge-extension", "background.js"), "utf8");
const chromeContent = fs.readFileSync(path.join(repoRoot, "chrome-extension", "content_script.js"), "utf8");
const edgeContent = fs.readFileSync(path.join(repoRoot, "edge-extension", "content_script.js"), "utf8");
assert(chromeBackground === edgeBackground, "Chrome and Edge background command routing must stay identical.");
assert(chromeContent === edgeContent, "Chrome and Edge content command polling must stay identical.");

console.log("Chromium extension architecture validation passed.");
