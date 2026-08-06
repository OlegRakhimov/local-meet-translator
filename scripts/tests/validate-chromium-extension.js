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
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

  assert(manifest.version === "1.7.6", `${name} extension version must include live desktop pairing repair.`);
  assert(!/127\.0\.0\.1:18798/.test(contentScript), `${name} content_script must not call localhost directly.`);
  assert(!/localhost:18798/.test(contentScript), `${name} content_script must not call localhost directly.`);
  assert(!/127\.0\.0\.1:18798/.test(popup), `${name} popup must not call localhost directly.`);
  assert(/\bX-Desktop-Extension-Token\b/.test(background), `${name} background must forward the desktop extension token.`);
  assert(/\bPAIR_WITH_DESKTOP\b/.test(background), `${name} background must implement pairing through the desktop app.`);
  assert(/\bEXPECTED_DESKTOP_PRODUCT_ID\b/.test(background), `${name} background must verify Local Meet Translator identity.`);
  assert(/local\.meet\.translator\.desktop/.test(background), `${name} background must use the Local Meet Translator product ID.`);
  assert(/\bensureDesktopToken\b/.test(background), `${name} background must repair a stale desktop token.`);
  assert(/\bcheckDesktopHealth\b/.test(background), `${name} background must verify the live desktop session.`);
  assert(/\bDESKTOP_COMMAND_POLL\b/.test(background), `${name} background must own desktop command polling.`);
  assert(/\backDesktopCommand\b/.test(background), `${name} background must post desktop command acknowledgements.`);
  assert(/\bfinalizeDesktopCommandResult\b/.test(background), `${name} background must finalize command results and own ACK delivery.`);
  assert(/\bupdateDesktopCommandCursor\b/.test(background), `${name} background must persist the accepted command cursor.`);
  assert(!/\bsendCommandAck\b/.test(contentScript), `${name} content_script must not send desktop command acknowledgements.`);
  assert(!/type:\s*["']DESKTOP_COMMAND_ACK["']/.test(contentScript), `${name} content_script must not emit DESKTOP_COMMAND_ACK.`);
  assert(/\bPAIR_WITH_DESKTOP\b/.test(popup), `${name} popup must expose desktop pairing.`);
  assert(/\bpreloadPairingCode\b/.test(popup), `${name} popup must preload the live pairing code.`);
  assert(/\bautoPairAndCheckDesktop\b/.test(popup), `${name} popup must auto-pair with the running desktop app.`);
  assert(!/\bdesktopExtensionPairingCode\b/.test(background), `${name} background must not reuse a cached pairing code.`);
  assert(!/\bdesktopExtensionPairingCode\b/.test(popup), `${name} popup must not display a cached pairing code.`);
}


const desktopMain = fs.readFileSync(path.join(repoRoot, "desktop-app", "src", "main.js"), "utf8");
const coordinator = fs.readFileSync(path.join(repoRoot, "desktop-app", "src", "main", "extension-state.js"), "utf8");
assert(/if\s*\(\s*!ackResult\.duplicate\s*\)/.test(desktopMain), "Desktop ACK endpoint must suppress duplicate side effects and logs.");
assert(/duplicate:\s*true/.test(coordinator), "Desktop coordinator must return an idempotent duplicate ACK result.");
assert(/const DESKTOP_PRODUCT_ID = 'local\.meet\.translator\.desktop'/.test(desktopMain), "Desktop server must publish the Local Meet Translator product ID.");
assert(/desktopProductId:\s*DESKTOP_PRODUCT_ID/.test(desktopMain), "Desktop health and pairing responses must include desktopProductId.");

const chromeBackground = fs.readFileSync(path.join(repoRoot, "chrome-extension", "background.js"), "utf8");
const edgeBackground = fs.readFileSync(path.join(repoRoot, "edge-extension", "background.js"), "utf8");
const chromeContent = fs.readFileSync(path.join(repoRoot, "chrome-extension", "content_script.js"), "utf8");
const edgeContent = fs.readFileSync(path.join(repoRoot, "edge-extension", "content_script.js"), "utf8");
assert(chromeBackground === edgeBackground, "Chrome and Edge background command routing must stay identical.");
assert(chromeContent === edgeContent, "Chrome and Edge content command polling must stay identical.");

console.log("Chromium extension architecture validation passed.");
