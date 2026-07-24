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
  assert(/\bDESKTOP_COMMAND_ACK\b/.test(background), `${name} background must own desktop command acknowledgements.`);
  assert(/\bPAIR_WITH_DESKTOP\b/.test(popup), `${name} popup must expose desktop pairing.`);
}

console.log("Chromium extension architecture validation passed.");
