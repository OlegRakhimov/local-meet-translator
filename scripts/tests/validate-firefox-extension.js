const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "firefox-extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return fs.readFileSync(path.join(extensionDir, file), "utf8");
}

const requiredFiles = [
  "background.js",
  "firefox_audio.js",
  "firefox_page_bridge.js",
  "firefox_page_bridge_loader.js",
  "content_script.js",
  "popup.js"
];

for (const file of requiredFiles) {
  new vm.Script(read(file), { filename: file });
}

// Firefox loads both persistent background scripts into the same global page.
// Compiling them together detects regressions such as redeclaring `let running`.
const combinedBackgroundSource = manifest.background.scripts
  .map(file => `\n// ${file}\n${read(file)}`)
  .join("\n");
new vm.Script(combinedBackgroundSource, { filename: "firefox-background-page.js" });

assert(manifest.manifest_version === 2, "Firefox extension must use its dedicated Manifest V2 configuration.");
assert(manifest.version === "1.7.6", "Firefox extension version must include the cross-browser pairing and MAIN-world bridge fixes.");
assert(manifest.background && manifest.background.persistent === true, "Firefox audio pipeline requires a persistent background page.");
assert(
  JSON.stringify(manifest.background.scripts) === JSON.stringify(["firefox_audio.js", "background.js"]),
  "Firefox background scripts must load the audio pipeline before the controller."
);
assert(
  Number.parseInt(manifest.browser_specific_settings?.gecko?.strict_min_version, 10) >= 142,
  "Firefox 142+ is required for built-in data-collection consent on all declared Firefox targets."
);
assert(
  manifest.browser_specific_settings?.gecko?.id === "local-meet-translator@example.local",
  "Firefox extension identity must remain Local Meet Translator."
);

const pageBridgeEntry = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.includes("firefox_page_bridge.js")
);
const loaderEntry = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.includes("firefox_page_bridge_loader.js")
);
assert(pageBridgeEntry, "Firefox page bridge is missing from content_scripts.");
assert(loaderEntry, "Firefox page bridge loader is missing from content_scripts.");
assert(pageBridgeEntry.world === "MAIN", "Firefox page bridge must run in the page MAIN world.");
assert(loaderEntry.world === "ISOLATED", "Firefox page bridge loader must keep WebExtension API access in the ISOLATED world.");
assert(
  manifest.content_scripts.indexOf(pageBridgeEntry) < manifest.content_scripts.indexOf(loaderEntry),
  "Firefox MAIN-world page bridge must be declared before its ISOLATED-world loader."
);
assert(pageBridgeEntry.run_at === "document_start", "Firefox MAIN-world page bridge must load before meeting code.");
assert(loaderEntry.run_at === "document_start", "Firefox loader must start before meeting code.");
assert(pageBridgeEntry.all_frames === true && loaderEntry.all_frames === true, "Firefox bridge must cover meeting subframes.");
assert(
  !Array.isArray(manifest.web_accessible_resources) || !manifest.web_accessible_resources.includes("firefox_page_bridge.js"),
  "Firefox page bridge must not rely on CSP-sensitive script-tag injection."
);

const forbidden = [
  /\bchrome\.offscreen\b/,
  /\bchrome\.tabCapture\b/,
  /\bchromeMediaSource\b/,
  /\bOFFSCREEN_(?:START|STOP)\b/
];
const runtimeSource = requiredFiles.map(read).join("\n");
for (const pattern of forbidden) {
  assert(!pattern.test(runtimeSource), `Firefox runtime still contains Chromium-only API/protocol: ${pattern}`);
}

const background = read("background.js");
const popup = read("popup.js");
const pageBridge = read("firefox_page_bridge.js");
const loader = read("firefox_page_bridge_loader.js");

assert(/\bRTCPeerConnection\b/.test(pageBridge), "Firefox page bridge does not intercept WebRTC connections.");
assert(/\bMediaRecorder\b/.test(pageBridge), "Firefox page bridge does not record remote audio tracks.");
assert(/message\.type\s*===\s*"probe"/.test(pageBridge), "Firefox MAIN-world bridge does not answer readiness probes.");
assert(/\bprobeBridge\b/.test(loader), "Firefox loader does not probe the MAIN-world bridge.");
assert(!/createElement\(["']script["']\)/.test(loader), "Firefox loader still uses CSP-sensitive script-tag injection.");
assert(/\bLMTFirefoxAudio\b/.test(background), "Firefox controller is not connected to its audio pipeline.");
assert(/\bEXPECTED_DESKTOP_PRODUCT_ID\b/.test(background), "Firefox background does not verify desktop identity.");
assert(/local\.meet\.translator\.desktop/.test(background), "Firefox background must expect Local Meet Translator.");
assert(/\bgetDesktopPairingCode\b/.test(background), "Firefox background does not fetch the live pairing code.");
assert(/\bensureDesktopToken\b/.test(background), "Firefox background does not repair stale tokens.");
assert(/\bSYNC_WITH_DESKTOP\b/.test(background), "Firefox background does not expose live desktop synchronization.");
assert(/\bensureDesktopIdentitySync\b/.test(background), "Firefox background does not keep desktop identity synchronized.");
assert(/desktopSessionId\s*===\s*liveSessionId/.test(background), "Firefox background trusts a cached token without checking the live session.");
assert(/\bPAIR_WITH_DESKTOP\b/.test(background), "Firefox background does not expose automatic pairing.");
assert(/\bDESKTOP_PAIRING_CODE\b/.test(background), "Firefox background does not expose the live pairing code.");
assert(/\bDESKTOP_HEALTH\b/.test(background), "Firefox background does not validate the desktop app.");
assert(/\bpreloadPairingCode\b/.test(popup), "Firefox popup does not preload the live pairing code.");
assert(/\bautoPairAndCheckDesktop\b/.test(popup), "Firefox popup does not auto-pair with the desktop app.");
assert(/\bSYNC_WITH_DESKTOP\b/.test(popup), "Firefox popup does not synchronize with the live desktop session.");
assert(!/\bdesktopExtensionPairingCode\b/.test(background), "Firefox background must not reuse a cached pairing code.");
assert(!/\bdesktopExtensionPairingCode\b/.test(popup), "Firefox popup must not display a cached pairing code.");
assert(!/127\.0\.0\.1:18798/.test(read("content_script.js")), "content_script must not talk to localhost directly.");
assert(!/127\.0\.0\.1:18798/.test(popup), "popup must not talk to localhost directly.");
assert(/extension-command/.test(background), "background must own the desktop command polling channel.");

console.log("Firefox extension architecture validation passed.");
