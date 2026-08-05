const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "firefox-extension");
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

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
  "content_script.js"
];

for (const file of requiredFiles) {
  const source = read(file);
  new vm.Script(source, { filename: file });
}

assert(manifest.manifest_version === 2, "Firefox extension must use its dedicated Manifest V2 configuration.");
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
  JSON.stringify(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required) ===
    JSON.stringify(["authenticationInfo", "personalCommunications", "personallyIdentifyingInfo"]),
  "Firefox data transmission must be disclosed explicitly."
);
assert(
  Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources.includes("firefox_page_bridge.js"),
  "firefox_page_bridge.js must be web-accessible for main-world injection."
);

const loaderEntry = (manifest.content_scripts || []).find(entry =>
  Array.isArray(entry.js) && entry.js.includes("firefox_page_bridge_loader.js")
);
assert(loaderEntry, "Firefox page bridge loader is missing from content_scripts.");
assert(loaderEntry.run_at === "document_start", "Firefox page bridge must load before meeting code creates RTCPeerConnection instances.");
assert(loaderEntry.all_frames === true, "Firefox page bridge must cover meeting subframes.");

const forbidden = [
  /\bchrome\.offscreen\b/,
  /\bchrome\.tabCapture\b/,
  /\bchromeMediaSource\b/,
  /\bOFFSCREEN_(?:START|STOP)\b/
];
const firefoxRuntimeSource = requiredFiles.map(read).join("\n");
for (const pattern of forbidden) {
  assert(!pattern.test(firefoxRuntimeSource), `Firefox runtime still contains Chromium-only API/protocol: ${pattern}`);
}

assert(/\bRTCPeerConnection\b/.test(read("firefox_page_bridge.js")), "Firefox page bridge does not intercept WebRTC connections.");
assert(/\bMediaRecorder\b/.test(read("firefox_page_bridge.js")), "Firefox page bridge does not record remote audio tracks.");
assert(/\bLMTFirefoxAudio\b/.test(read("background.js")), "Firefox background controller is not connected to its audio pipeline.");
assert(/\bPAIR_DESKTOP\b/.test(read("background.js")), "Firefox background does not implement desktop pairing.");
assert(!/127\.0\.0\.1:18798/.test(read("content_script.js")), "content_script must not talk to localhost directly.");
assert(!/127\.0\.0\.1:18798/.test(read("popup.js")), "popup must not talk to localhost directly.");
assert(/extension-command/.test(read("background.js")), "background must own the desktop command polling channel.");

console.log("Firefox extension architecture validation passed.");
