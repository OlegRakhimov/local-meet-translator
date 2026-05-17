const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

if (process.platform === 'win32') {
  app.setAppUserModelId('local.meet.translator.desktop');
}

const isPackaged = app.isPackaged;
const repoRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');

// Persistent user config location. This survives app reinstall/update and does not depend on the project folder.
const userConfigDir = path.join(app.getPath('appData'), 'Local Meet Translator');
const envPath = path.join(userConfigDir, '.env');
const legacyEnvPath = path.join(repoRoot, '.env');
const extensionPath = path.join(repoRoot, 'edge-extension');
let mainWindow;
let bridgeProc = null;
let voiceProc = null;
let configServer = null;
let appClosing = false;
let extensionCommandSeq = 0;
const desktopSessionId = crypto.randomBytes(12).toString('hex');
let extensionCommand = { seq: 0, sessionId: desktopSessionId, action: 'idle', issuedAt: 0 };
const extensionClients = new Map();
let lastExtensionAck = null;

function sendLog(line) {
  const msg = `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${line}`;
  try {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('app:log', msg);
  } catch (_) {
    // Window is already closing/destroyed. Logging must never crash the app.
  }
}
function parseDotEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
function renderDotEnv(obj) {
  const order = ['OPENAI_API_KEY','LOCAL_MEET_TRANSLATOR_PORT','LOCAL_MEET_TRANSLATOR_TOKEN','OPENAI_TRANSCRIBE_MODEL','OPENAI_TEXT_MODEL','ENABLE_TTS','OPENAI_TTS_MODEL','OPENAI_TTS_VOICE','OPENAI_TTS_FORMAT','OPENAI_TTS_SPEED','ENABLE_VOICE_CONVERSION','VOICE_CONVERSION_URL','VOICE_CONVERSION_TOKEN','VOICE_CONVERSION_FALLBACK_TO_ORIGINAL','VOICE_CONVERSION_TIMEOUT_MS','EXT_SOURCE_LANG','EXT_TARGET_LANG','EXT_CHUNK_SECONDS','EXT_TTS_ENABLED','EXT_TTS_VOICE','EXT_TTS_SPEED','EXT_MIC_TX_ENABLED','EXT_MIC_TX_SOURCE_LANG','EXT_MIC_TX_TARGET_LANG','EXT_MIC_TX_CHUNK_SECONDS','EXT_MIC_DEVICE_ID','EXT_MIC_DEVICE_NAME','EXT_TTS_SINK_DEVICE_ID','EXT_TTS_SINK_DEVICE_NAME','EXT_OUT_VOICE_STYLE','EXT_RVC_MODEL_TAG','EXT_SHOW_OUTGOING_SUBTITLES','VOICE_CONVERSION_HOST','VOICE_CONVERSION_PORT','RVC_INFER_CMD','RVC_INFER_TIMEOUT_SEC'];
  const lines = ['# Local Meet Translator desktop-generated config. Do not commit this file.'];
  const used = new Set();
  for (const k of order) { if (obj[k] !== undefined) { lines.push(`${k}=${obj[k]}`); used.add(k); } }
  for (const [k,v] of Object.entries(obj)) if (!used.has(k)) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

function ensureUserConfigDir() {
  fs.mkdirSync(userConfigDir, { recursive: true });
}
function looksLikeUsefulEnv(file) {
  try {
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
    const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'));
    return !!(parsed.OPENAI_API_KEY || parsed.LOCAL_MEET_TRANSLATOR_TOKEN || parsed.LOCAL_MEET_TRANSLATOR_PORT);
  } catch (_) {
    return false;
  }
}
function findLegacyEnvCandidates() {
  const candidates = [];
  const add = (file) => {
    if (file && !candidates.includes(file)) candidates.push(file);
  };

  add(legacyEnvPath);
  add(path.join(process.resourcesPath || '', '.env'));

  const home = app.getPath('home');
  const androidStudioProjects = path.join(home, 'AndroidStudioProjects');
  add(path.join(androidStudioProjects, 'local-meet-translator-desktop-package', '.env'));
  add(path.join(androidStudioProjects, 'local-meet-translator-desktop-command-echo-fix', 'local-meet-translator-desktop-package', '.env'));

  try {
    if (fs.existsSync(androidStudioProjects)) {
      for (const name of fs.readdirSync(androidStudioProjects)) {
        if (!name.toLowerCase().startsWith('local-meet-translator')) continue;
        const dir = path.join(androidStudioProjects, name);
        add(path.join(dir, '.env'));
        add(path.join(dir, 'local-meet-translator-desktop-package', '.env'));
      }
    }
  } catch (_) {}
  return candidates;
}
function migrateLegacyEnvIfNeeded() {
  ensureUserConfigDir();
  if (looksLikeUsefulEnv(envPath)) return { migrated: false, source: null };
  for (const candidate of findLegacyEnvCandidates()) {
    if (path.resolve(candidate) === path.resolve(envPath)) continue;
    if (!looksLikeUsefulEnv(candidate)) continue;
    fs.copyFileSync(candidate, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch (_) {}
    return { migrated: true, source: candidate };
  }
  return { migrated: false, source: null };
}

function getSystemLanguageCode() {
  const supported = new Set(['ru', 'pl', 'de', 'es', 'it']);
  let raw = 'en';
  try { raw = app.getLocale && app.getLocale() || raw; } catch (_) {}
  raw = String(raw || process.env.LANG || process.env.LANGUAGE || 'en').toLowerCase();
  const code = raw.split(/[_.-]/)[0];
  return supported.has(code) ? code : 'en';
}

function loadSettings() {
  migrateLegacyEnvIfNeeded();
  let s = {};
  if (fs.existsSync(envPath)) s = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
  s.OPENAI_API_KEY ||= '';
  s.LOCAL_MEET_TRANSLATOR_PORT ||= '8799';
  s.LOCAL_MEET_TRANSLATOR_TOKEN ||= crypto.randomBytes(24).toString('hex');
  s.OPENAI_TRANSCRIBE_MODEL ||= 'whisper-1';
  s.OPENAI_TEXT_MODEL ||= 'gpt-4o-mini';
  s.ENABLE_TTS ||= 'true';
  s.OPENAI_TTS_MODEL ||= 'gpt-4o-mini-tts';
  s.OPENAI_TTS_VOICE ||= 'onyx';
  s.OPENAI_TTS_FORMAT ||= 'mp3';
  s.OPENAI_TTS_SPEED ||= '1.0';
  s.ENABLE_VOICE_CONVERSION ||= 'false';
  s.VOICE_CONVERSION_HOST ||= '127.0.0.1';
  s.VOICE_CONVERSION_PORT ||= '18799';
  s.VOICE_CONVERSION_URL ||= `http://127.0.0.1:${s.VOICE_CONVERSION_PORT}`;
  s.VOICE_CONVERSION_TOKEN ||= '';
  s.VOICE_CONVERSION_FALLBACK_TO_ORIGINAL ||= 'true';
  s.VOICE_CONVERSION_TIMEOUT_MS ||= '180000';
  s.RVC_INFER_CMD ||= '';
  s.RVC_INFER_TIMEOUT_SEC ||= '180';
  s.EXT_SOURCE_LANG ||= 'auto';
  s.EXT_TARGET_LANG ||= getSystemLanguageCode();
  if (!s.EXT_CHUNK_SECONDS || s.EXT_CHUNK_SECONDS === '5') s.EXT_CHUNK_SECONDS = '3';
  s.EXT_TTS_ENABLED ||= 'false';
  s.EXT_TTS_VOICE ||= 'onyx';
  s.EXT_TTS_SPEED ||= '1.0';
  s.EXT_MIC_TX_ENABLED ||= 'false';
  s.EXT_MIC_TX_SOURCE_LANG ||= getSystemLanguageCode();
  s.EXT_MIC_TX_TARGET_LANG ||= 'en';
  s.EXT_MIC_TX_CHUNK_SECONDS ||= '5';
  s.EXT_MIC_DEVICE_ID ||= '';
  s.EXT_MIC_DEVICE_NAME ||= '';
  s.EXT_TTS_SINK_DEVICE_ID ||= '';
  s.EXT_TTS_SINK_DEVICE_NAME ||= '';
  // Safe default for meeting voice: try VB-Cable by name instead of playing translated voice into speakers.
  if (s.EXT_MIC_TX_ENABLED === 'true' && !s.EXT_TTS_SINK_DEVICE_ID && !s.EXT_TTS_SINK_DEVICE_NAME) s.EXT_TTS_SINK_DEVICE_NAME = 'CABLE Input';
  s.EXT_OUT_VOICE_STYLE ||= 'openai';
  s.EXT_RVC_MODEL_TAG ||= '';
  s.EXT_SHOW_OUTGOING_SUBTITLES ||= 'false';
  s.__ENV_PATH = envPath;
  s.__CONFIG_DIR = userConfigDir;
  return s;
}
function saveSettings(next) {
  ensureUserConfigDir();
  const merged = { ...loadSettings(), ...next };
  if (!merged.LOCAL_MEET_TRANSLATOR_TOKEN) merged.LOCAL_MEET_TRANSLATOR_TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(envPath, renderDotEnv(merged), { mode: 0o600 });
  return merged;
}
function requestJson(url, token) {
  return new Promise(resolve => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', timeout: 1200, headers: token ? { 'X-Auth-Token': token } : {} }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, status:0, body:'timeout' }); });
    req.on('error', e => resolve({ ok:false, status:0, body:e.message }));
    req.end();
  });
}
function findBridgeJar() {
  const target = path.join(repoRoot, 'local-meet-bridge', 'target');
  if (!fs.existsSync(target)) return null;
  const jars = fs.readdirSync(target).filter(f => f.endsWith('.jar') && !f.startsWith('original-')).sort();
  return jars.length ? path.join(target, jars[jars.length - 1]) : null;
}
function killProcessTree(proc, tag) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { timeout: 5000 }, (err) => {
        if (err) sendLog(`[${tag}] taskkill failed: ${err.message}`);
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (e) {
    sendLog(`[${tag}] kill failed: ${e.message}`);
  }
}
function spawnLogged(cmd, args, options, tag) {
  const p = spawn(cmd, args, { ...options, shell: false });
  p.stdout.on('data', d => sendLog(`[${tag}] ${String(d).trimEnd()}`));
  p.stderr.on('data', d => sendLog(`[${tag}] ${String(d).trimEnd()}`));
  p.on('exit', code => sendLog(`[${tag}] exited with code ${code}`));
  p.on('error', err => sendLog(`[${tag}] failed: ${err.message}`));
  return p;
}
function writeJsonResponse(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function boolFromEnv(value, fallback = false) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}
function intFromEnv(value, fallback, min, max) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function floatFromEnv(value, fallback, min, max) {
  const n = parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function getExtensionConfig() {
  const s = loadSettings();
  return {
    serverUrl: `http://127.0.0.1:${s.LOCAL_MEET_TRANSLATOR_PORT}`,
    authToken: s.LOCAL_MEET_TRANSLATOR_TOKEN,
    sourceLang: s.EXT_SOURCE_LANG || 'auto',
    targetLang: s.EXT_TARGET_LANG || getSystemLanguageCode(),
    chunkSeconds: intFromEnv(s.EXT_CHUNK_SECONDS, 3, 2, 15),
    ttsEnabled: boolFromEnv(s.EXT_TTS_ENABLED, false),
    ttsVoice: s.EXT_TTS_VOICE || 'onyx',
    ttsSpeed: floatFromEnv(s.EXT_TTS_SPEED, 1.0, 0.25, 4.0),
    micTxEnabled: boolFromEnv(s.EXT_MIC_TX_ENABLED, false),
    micTxSourceLang: s.EXT_MIC_TX_SOURCE_LANG || getSystemLanguageCode(),
    micTxTargetLang: s.EXT_MIC_TX_TARGET_LANG || 'en',
    micTxChunkSeconds: intFromEnv(s.EXT_MIC_TX_CHUNK_SECONDS, 5, 2, 15),
    micDeviceId: s.EXT_MIC_DEVICE_ID || '',
    micDeviceName: s.EXT_MIC_DEVICE_NAME || '',
    ttsSinkDeviceId: s.EXT_TTS_SINK_DEVICE_ID || '',
    ttsSinkDeviceName: s.EXT_TTS_SINK_DEVICE_NAME || '',
    outVoiceStyle: s.EXT_OUT_VOICE_STYLE || 'openai',
    rvcModelTag: s.EXT_RVC_MODEL_TAG || '',
    showOutgoingSubtitles: boolFromEnv(s.EXT_SHOW_OUTGOING_SUBTITLES, false)
  };
}
function issueExtensionCommand(action) {
  extensionCommandSeq += 1;
  extensionCommand = { seq: extensionCommandSeq, sessionId: desktopSessionId, action, issuedAt: Date.now(), ...getExtensionConfig() };
  sendLog(`Extension command queued: ${action} #${extensionCommand.seq}`);
  setTimeout(() => {
    if (extensionCommand.seq !== extensionCommandSeq || extensionCommand.action !== action) return;
    if (lastExtensionAck && lastExtensionAck.seq === extensionCommand.seq) return;
    const clients = getRecentExtensionClients();
    if (!clients.length) {
      sendLog(`Extension command #${extensionCommand.seq} was not picked up. Reload the Meet/Zoom/Teams tab after reloading the extension; no meeting content script is connected to http://127.0.0.1:18798.`);
    } else {
      sendLog(`Extension command #${extensionCommand.seq} has no ACK yet. Connected meeting tab(s): ${clients.map(c => c.url).join(' | ')}`);
    }
  }, 3500);
  return extensionCommand;
}
function rememberExtensionClient(url) {
  const clean = String(url || '').trim();
  if (!clean) return;
  const key = clean.slice(0, 300);
  const prev = extensionClients.get(key);
  extensionClients.set(key, { url: key, lastSeen: Date.now(), firstSeen: prev ? prev.firstSeen : Date.now() });
}
function getRecentExtensionClients(maxAgeMs = 15000) {
  const now = Date.now();
  for (const [key, client] of extensionClients) {
    if (now - client.lastSeen > 5 * 60 * 1000) extensionClients.delete(key);
  }
  return Array.from(extensionClients.values()).filter(c => now - c.lastSeen <= maxAgeMs);
}
function startConfigServer() {
  if (configServer) return;
  configServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Auth-Token');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || '/', 'http://127.0.0.1:18798');
    const settings = loadSettings();

    if (url.pathname === '/health') {
      writeJsonResponse(res, 200, { ok:true, service:'local-meet-translator-desktop', sessionId: desktopSessionId, commandSeq: extensionCommand.seq, command: extensionCommand.action });
      return;
    }

    if (url.pathname === '/extension-config') {
      writeJsonResponse(res, 200, { ok:true, ...getExtensionConfig() });
      return;
    }

    if (url.pathname === '/extension-command') {
      rememberExtensionClient(url.searchParams.get('url') || '');
      const lastSeqRaw = Number(url.searchParams.get('lastSeq') || '0');
      const clientSessionId = String(url.searchParams.get('sessionId') || '');
      const lastSeq = clientSessionId === desktopSessionId ? lastSeqRaw : 0;
      const ageMs = Date.now() - (extensionCommand.issuedAt || 0);
      const active = extensionCommand.seq > lastSeq && extensionCommand.action !== 'idle' && ageMs < 10 * 60 * 1000;
      writeJsonResponse(res, 200, {
        ok: true,
        sessionId: desktopSessionId,
        hasCommand: active,
        command: active ? extensionCommand : { seq: extensionCommand.seq, sessionId: desktopSessionId, action: 'idle' },
        serverUrl: `http://127.0.0.1:${settings.LOCAL_MEET_TRANSLATOR_PORT}`,
        authToken: settings.LOCAL_MEET_TRANSLATOR_TOKEN
      });
      return;
    }

    if (url.pathname === '/extension-command/ack') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (_) {}
        const seq = data.seq || url.searchParams.get('seq') || '?';
        const action = data.action || url.searchParams.get('action') || '?';
        const ok = data.ok === undefined ? true : !!data.ok;
        const text = data.message || data.error || '';
        lastExtensionAck = { seq: Number(seq), action, ok, at: Date.now() };
        sendLog(`Extension ${ok ? 'ACK' : 'ERROR'} for ${action} #${seq}${text ? ': ' + text : ''}`);
        writeJsonResponse(res, 200, { ok:true });
      });
      return;
    }

    writeJsonResponse(res, 404, { ok:false, error:'not found' });
  });
  configServer.listen(18798, '127.0.0.1', () => sendLog('Extension config/command server: http://127.0.0.1:18798'));
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1060, height: 880, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (event) => {
    if (appClosing) return;
    appClosing = true;
    event.preventDefault();
    issueExtensionCommand('stop');
    killProcessTree(bridgeProc, 'bridge');
    killProcessTree(voiceProc, 'voice');
    setTimeout(() => {
      try { if (configServer) configServer.close(); } catch (_) {}
      try { mainWindow.destroy(); } catch (_) {}
      app.quit();
    }, 800);
  });
}
app.whenReady().then(() => {
  const migration = migrateLegacyEnvIfNeeded();
  startConfigServer();
  createWindow();
  setTimeout(() => {
    sendLog(`Config path: ${envPath}`);
    if (migration.migrated) sendLog(`Migrated legacy .env from: ${migration.source}`);
  }, 400);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  appClosing = true;
  try { if (mainWindow && !mainWindow.isDestroyed()) issueExtensionCommand('stop'); } catch (_) {}
  killProcessTree(bridgeProc, 'bridge');
  killProcessTree(voiceProc, 'voice');
  try { if (configServer) configServer.close(); } catch (_) {}
});

ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_e, settings) => ({ ok:true, settings: saveSettings(settings), message: `Saved ${envPath}` }));
ipcMain.handle('env:open', () => { if (!fs.existsSync(envPath)) saveSettings({}); shell.openPath(envPath); return { ok:true }; });
ipcMain.handle('extension:open', () => { shell.openPath(extensionPath); return { ok:true, message: extensionPath }; });
ipcMain.handle('bridge:start', () => {
  if (bridgeProc) return { ok:true, message:'Bridge is already running from this desktop app.' };
  const s = loadSettings();
  if (!s.OPENAI_API_KEY) return { ok:false, message:'OPENAI_API_KEY is empty. Save it first.' };
  const jar = findBridgeJar();
  if (!jar) return { ok:false, message:'Bridge jar not found. Build local-meet-bridge first: mvn -DskipTests package' };
  bridgeProc = spawnLogged('java', ['-jar', jar], { cwd: path.dirname(jar), env: { ...process.env, ...s } }, 'bridge');
  bridgeProc.on('exit', () => { bridgeProc = null; });
  return { ok:true, message:'Bridge start requested.' };
});
ipcMain.handle('bridge:stop', () => { if (bridgeProc) { killProcessTree(bridgeProc, 'bridge'); bridgeProc = null; return { ok:true, message:'Bridge stopped.' }; } return { ok:true, message:'Bridge was not started by this app. If health still shows OK, an external bridge process is already running.' }; });
ipcMain.handle('voice:start', () => {
  if (voiceProc) return { ok:true, message:'Voice conversion is already running from this desktop app.' };
  const s = loadSettings();
  const server = path.join(repoRoot, 'voice-conversion', 'server.py');
  if (!fs.existsSync(server)) return { ok:false, message:'voice-conversion/server.py not found.' };
  const py = process.platform === 'win32' ? 'python' : 'python3';
  voiceProc = spawnLogged(py, ['-m', 'uvicorn', 'server:app', '--host', s.VOICE_CONVERSION_HOST || '127.0.0.1', '--port', s.VOICE_CONVERSION_PORT || '18799'], { cwd: path.dirname(server), env: { ...process.env, ...s } }, 'voice');
  voiceProc.on('exit', () => { voiceProc = null; });
  return { ok:true, message:'Voice conversion start requested.' };
});
ipcMain.handle('voice:stop', () => { if (voiceProc) { killProcessTree(voiceProc, 'voice'); voiceProc = null; return { ok:true, message:'Voice conversion stopped.' }; } return { ok:true, message:'Voice conversion was not started by this app.' }; });
ipcMain.handle('health:check', async () => {
  const s = loadSettings();
  const b = await requestJson(`http://127.0.0.1:${s.LOCAL_MEET_TRANSLATOR_PORT}/health`, s.LOCAL_MEET_TRANSLATOR_TOKEN);
  const v = await requestJson(`http://127.0.0.1:${s.VOICE_CONVERSION_PORT}/health`, s.VOICE_CONVERSION_TOKEN);
  return { bridge: { ok:b.ok, text:b.ok ? (bridgeProc ? 'OK (started by desktop)' : 'OK (external/already running)') : (b.body || 'offline') }, voice: { ok:v.ok, text:v.ok ? (voiceProc ? 'OK (started by desktop)' : 'OK (external/already running)') : (v.body || 'offline') } };
});
ipcMain.handle('audio:checkCable', () => new Promise(resolve => {
  if (process.platform !== 'win32') { resolve({ ok:false, text:'Automatic VB-Cable detection is implemented for Windows only.' }); return; }
  execFile('powershell.exe', ['-NoProfile','-Command', "Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name"], { timeout: 5000 }, (err, stdout) => {
    if (err) { resolve({ ok:false, text:`Audio device check failed: ${err.message}` }); return; }
    const names = stdout.toLowerCase();
    const ok = names.includes('cable input') || names.includes('cable output') || names.includes('vb-audio');
    resolve({ ok, text: ok ? 'VB-Cable-like device found.' : 'VB-Cable not found. Install VB-Audio Virtual Cable, then choose CABLE Input as TTS sink and CABLE Output as meeting microphone.' });
  });
}));

ipcMain.handle('extension:startTranslation', async () => {
  const s = loadSettings();
  const b = await requestJson(`http://127.0.0.1:${s.LOCAL_MEET_TRANSLATOR_PORT}/health`, s.LOCAL_MEET_TRANSLATOR_TOKEN);
  if (!b.ok) return { ok:false, message:`Bridge is not ready: ${b.body || 'offline'}` };
  const clients = getRecentExtensionClients();
  if (!clients.length) {
    sendLog('No connected Meet/Zoom/Teams content script seen yet. Open the meeting tab and reload it once after loading/reloading the extension.');
  } else {
    sendLog(`Connected meeting tab(s): ${clients.map(c => c.url).join(' | ')}`);
  }
  const cmd = issueExtensionCommand('start');
  return { ok:true, message:`Start command sent to extension (#${cmd.seq}). Open the meeting tab and keep it loaded; control remains in the desktop app.` };
});
ipcMain.handle('extension:stopTranslation', () => {
  const cmd = issueExtensionCommand('stop');
  return { ok:true, message:`Stop command sent to extension (#${cmd.seq}).` };
});
