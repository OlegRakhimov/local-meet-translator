const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { createConfigStore, boolFromEnv, intFromEnv, floatFromEnv } = require('./main/config-store');
const { SessionStateMachine, SESSION_STATES } = require('./main/session-state');
const { createWindowManager } = require('./main/window-manager');
const { ExtensionClientRegistry, ExtensionCommandCoordinator } = require('./main/extension-state');
const { createSubtitleOverlayController, sanitizeSubtitleEvent } = require('./main/subtitle-overlay');

if (process.platform === 'win32') {
  app.setAppUserModelId('local.meet.translator.desktop');
}

const isPackaged = app.isPackaged;
const repoRoot = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');

// Persistent user config location. This survives app reinstall/update and does not depend on the project folder.
const userConfigDir = path.join(app.getPath('appData'), 'Local Meet Translator');
const envPath = path.join(userConfigDir, '.env');
const legacyEnvPath = path.join(repoRoot, '.env');
const subtitleWindowStatePath = path.join(userConfigDir, 'subtitle-window-state.json');
const extensionPath = isPackaged ? path.join(repoRoot, 'browser-extensions') : repoRoot;
const configStore = createConfigStore({ app, repoRoot, userConfigDir, envPath, legacyEnvPath });
const { loadSettings, saveSettings, migrateLegacyEnvIfNeeded, getSystemLanguageCode } = configStore;
const translationSession = new SessionStateMachine({ mode: 'translator' });
let windowManager;
let subtitleOverlay;
let bridgeProc = null;
let voiceProc = null;
let configServer = null;
let appClosing = false;
const desktopSessionId = crypto.randomBytes(12).toString('hex');
const extensionCommandCoordinator = new ExtensionCommandCoordinator({ sessionId: desktopSessionId });
const extensionClientRegistry = new ExtensionClientRegistry();
const extensionClientLogState = new Map();
const deliveredCommandLogKeys = new Set();
const ALLOWED_EXTENSION_ORIGIN_RE = /^(moz-extension|chrome-extension|edge-extension):\/\/[a-z0-9-]+$/i;

function sendLog(line) {
  const msg = `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${line}`;
  try {
    if (!windowManager) return;
    windowManager.send('app:log', msg);
  } catch (_) {
    // Window is already closing/destroyed. Logging must never crash the app.
  }
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
  const canonical = path.join(target, 'local-meet-bridge.jar');
  if (fs.existsSync(canonical)) return canonical;
  const jars = fs.readdirSync(target).filter(f => f.endsWith('.jar') && !f.startsWith('original-')).sort();
  return jars.length ? path.join(target, jars[jars.length - 1]) : null;
}
function findJavaExecutable() {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    path.join(repoRoot, 'java-runtime', 'bin', executable),
    path.join(repoRoot, 'local-meet-bridge', 'target', 'java-runtime', 'bin', executable)
  ];
  return candidates.find(file => fs.existsSync(file)) || null;
}
function findVoiceExecutable() {
  const executable = process.platform === 'win32' ? 'local-meet-voice-conversion.exe' : 'local-meet-voice-conversion';
  const candidates = [
    path.join(repoRoot, 'voice-conversion', executable),
    path.join(repoRoot, 'voice-conversion', 'target', executable)
  ];
  return candidates.find(file => fs.existsSync(file)) || null;
}

function startBridgeInternal() {
  if (bridgeProc) return { ok:true, message:'Bridge is already running from this desktop app.' };
  const s = loadSettings();
  if (!s.OPENAI_API_KEY) return { ok:false, message:'OPENAI_API_KEY is empty. Save it first.' };
  const jar = findBridgeJar();
  if (!jar) return { ok:false, message:'Bridge jar not found. Run BUILD_DESKTOP_WINDOWS.cmd from the project root.' };
  const java = findJavaExecutable();
  if (!java && isPackaged) return { ok:false, message:'Bundled Java runtime not found. Reinstall the application.' };
  bridgeProc = spawnLogged(java || 'java', ['-jar', jar], { cwd: path.dirname(jar), env: { ...process.env, ...s } }, 'bridge');
  bridgeProc.on('exit', () => { bridgeProc = null; });
  return { ok:true, message:'Bridge start requested.' };
}

async function waitForBridgeReady(settings, timeoutMs = 8000) {
  const startedAt = Date.now();
  let last = { ok:false, status:0, body:'not checked' };
  while (Date.now() - startedAt < timeoutMs) {
    last = await requestJson(`http://127.0.0.1:${settings.LOCAL_MEET_TRANSLATOR_PORT}/health`, settings.LOCAL_MEET_TRANSLATOR_TOKEN);
    if (last.ok) return last;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return last;
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
function readJsonRequest(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    const fail = (statusCode, message) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(413, 'Request body is too large.');
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_) {
        const error = new Error('Invalid JSON body.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', error => fail(400, error.message || 'Could not read request body.'));
  });
}
function getExtensionConfig() {
  const s = loadSettings();
  return {
    serverUrl: `http://127.0.0.1:${s.LOCAL_MEET_TRANSLATOR_PORT}`,
    authToken: s.LOCAL_MEET_TRANSLATOR_TOKEN,
    sourceLang: s.EXT_SOURCE_LANG || 'auto',
    targetLang: s.EXT_TARGET_LANG || getSystemLanguageCode(),
    chunkSeconds: intFromEnv(s.EXT_CHUNK_SECONDS, 3, 2, 15),
    audioIsolationMode: boolFromEnv(s.EXT_AUDIO_ISOLATION_MODE, true),
    ttsEnabled: boolFromEnv(s.EXT_AUDIO_ISOLATION_MODE, true) ? false : boolFromEnv(s.EXT_TTS_ENABLED, false),
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
function getExtensionToken() {
  return loadSettings().DESKTOP_EXTENSION_TOKEN || '';
}
function getPairingCode() {
  return loadSettings().DESKTOP_EXTENSION_PAIRING_CODE || '';
}
function getRequestOrigin(req) {
  return String(req.headers.origin || req.headers.Origin || '').trim();
}
function isAllowedExtensionOrigin(origin) {
  const clean = String(origin || '').trim();
  const lower = clean.toLowerCase();
  // Chromium/Edge extension service-worker fetches normally include
  // chrome-extension://<id>, but some Edge builds / local loopback requests
  // send no Origin or the literal "null" origin. This server binds only to
  // 127.0.0.1, so allowing empty/null here is safe enough for the local
  // desktop companion and prevents false "Forbidden origin" failures.
  return clean === '' || lower === 'null' || ALLOWED_EXTENSION_ORIGIN_RE.test(clean);
}
function requireExtensionOrigin(req, res) {
  const origin = getRequestOrigin(req);
  if (!isAllowedExtensionOrigin(origin)) {
    writeJsonResponse(res, 403, { ok: false, error: 'Forbidden origin' });
    return null;
  }
  return origin;
}
function readExtensionToken(req) {
  const headers = req.headers || {};
  return String(headers['x-desktop-extension-token'] || headers['X-Desktop-Extension-Token'] || '').trim();
}
function requireExtensionToken(req, res, expectedToken) {
  const token = readExtensionToken(req);
  if (!expectedToken || token !== expectedToken) {
    writeJsonResponse(res, 401, { ok: false, error: 'Missing or invalid X-Desktop-Extension-Token' });
    return false;
  }
  return true;
}
function chooseExtensionClient() { return extensionClientRegistry.choose(); }
function issueExtensionCommand(action, selectedClient = null, overrides = {}) {
  const activeClient = extensionClientRegistry.getActive();
  const preferred = selectedClient || (action === 'stop' && activeClient ? activeClient : chooseExtensionClient());
  const command = extensionCommandCoordinator.issue(action, preferred, getExtensionConfig(), overrides || {});
  const modeText = command.micTxEnabled ? ' voice=ON' : ' voice=OFF';
  sendLog(`Extension command queued: ${action} #${command.seq}${preferred ? ` for ${preferred.url}` : ''}${modeText}`);
  setTimeout(() => {
    const snapshot = extensionCommandCoordinator.snapshot();
    if (snapshot.command.seq !== command.seq || snapshot.command.action !== action) return;
    if (snapshot.lastAck && snapshot.lastAck.seq === command.seq) return;
    const clients = getRecentExtensionClients();
    if (!clients.length) {
      sendLog(`Extension command #${command.seq} was not picked up. Reload the Meet/Zoom/Teams tab after reloading the extension; the browser extension background page is not polling http://127.0.0.1:18798 yet.`);
    } else {
      sendLog(`Extension command #${command.seq} has no ACK yet. Connected meeting tab(s): ${clients.map(c => c.url).join(' | ')}`);
    }
  }, 3500);
  return command;
}
function waitForExtensionAck(seq, timeoutMs = 22000) {
  return extensionCommandCoordinator.waitForAck(seq, timeoutMs);
}
function rememberExtensionClient(client) { return extensionClientRegistry.remember(client); }
function getRecentExtensionClients(maxAgeMs = 120000) { return extensionClientRegistry.recent(maxAgeMs); }
function startConfigServer() {
  if (configServer) return;
  configServer = http.createServer((req, res) => {
    const origin = getRequestOrigin(req);
    const extensionOriginAllowed = isAllowedExtensionOrigin(origin);
    if (extensionOriginAllowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Desktop-Extension-Token');
    }
    if (req.method === 'OPTIONS') {
      if (!extensionOriginAllowed) {
        writeJsonResponse(res, 403, { ok: false, error: 'Forbidden origin' });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1:18798');
    const settings = loadSettings();
    const extensionToken = settings.DESKTOP_EXTENSION_TOKEN || getExtensionToken();

    if (url.pathname.startsWith('/extension') || url.pathname.startsWith('/health') || url.pathname === '/extension-config') {
      if (!extensionOriginAllowed) {
        writeJsonResponse(res, 403, { ok: false, error: 'Forbidden origin' });
        return;
      }
    }

    if (url.pathname === '/health') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      const command = extensionCommandCoordinator.snapshot().command;
      writeJsonResponse(res, 200, { ok:true, service:'local-meet-translator-desktop', sessionId: desktopSessionId, commandSeq: command.seq, command: command.action });
      return;
    }

    if (url.pathname === '/extension-config') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      writeJsonResponse(res, 200, { ok:true, ...getExtensionConfig() });
      return;
    }

    if (url.pathname === '/extension/pairing-code' && req.method === 'GET') {
      writeJsonResponse(res, 200, {
        ok: true,
        pairingCode: settings.DESKTOP_EXTENSION_PAIRING_CODE || getPairingCode(),
        sessionId: desktopSessionId
      });
      return;
    }

    if (url.pathname === '/extension/pair' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (_) {}
        const pairingCode = String(data.pairingCode || '').trim().replace(/[\s-]+/g, '').toUpperCase();
        const expected = String(settings.DESKTOP_EXTENSION_PAIRING_CODE || getPairingCode()).trim().replace(/[\s-]+/g, '').toUpperCase();
        if (!pairingCode || pairingCode !== expected) {
          writeJsonResponse(res, 401, { ok: false, error: 'Invalid pairing code' });
          return;
        }
        writeJsonResponse(res, 200, {
          ok: true,
          token: extensionToken,
          sessionId: desktopSessionId,
          clientId: String(data.clientId || ''),
          pairingCode: settings.DESKTOP_EXTENSION_PAIRING_CODE || getPairingCode()
        });
      });
      return;
    }

    if (url.pathname === '/extension/subtitle' && req.method === 'POST') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      readJsonRequest(req, 64 * 1024)
        .then(data => {
          const event = sanitizeSubtitleEvent({
            ...data,
            clientId: data.clientId || '',
            tabId: data.tabId || '',
            url: data.url || ''
          });
          if (!subtitleOverlay) {
            writeJsonResponse(res, 503, { ok: false, error: 'Subtitle window is not initialized.' });
            return;
          }
          subtitleOverlay.pushSubtitle(event);
          writeJsonResponse(res, 200, { ok: true, eventId: event.id });
        })
        .catch(error => {
          writeJsonResponse(res, error.statusCode || 400, { ok: false, error: error.message || 'Invalid subtitle event.' });
        });
      return;
    }

    if (url.pathname === '/extension-client/armed' && req.method === 'POST') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (_) {}
        const client = rememberExtensionClient({
          clientId: data.clientId,
          url: data.url,
          visible: true,
          armed: true
        });
        if (client) {
          extensionClientRegistry.markActive(client.id);
          const previousLog = extensionClientLogState.get(client.id) || { url:'', at:0 };
          const now = Date.now();
          if (previousLog.url !== client.url || now - previousLog.at >= 30000) {
            sendLog(`Meeting tab connected for control: ${client.url}`);
            extensionClientLogState.set(client.id, { url: client.url, at: now });
          }
        }
        writeJsonResponse(res, client ? 200 : 400, { ok: !!client, clientId: client ? client.id : '', url: client ? client.url : '' });
      });
      return;
    }

    if (url.pathname === '/extension-command') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      const clientId = String(url.searchParams.get('clientId') || '');
      rememberExtensionClient({
        clientId,
        url: url.searchParams.get('url') || '',
        visible: url.searchParams.get('visible') === 'true'
      });
      const lastSeqRaw = Number(url.searchParams.get('lastSeq') || '0');
      const clientSessionId = String(url.searchParams.get('sessionId') || '');
      const lastSeq = clientSessionId === desktopSessionId ? lastSeqRaw : 0;
      const currentCommand = extensionCommandCoordinator.snapshot().command;
      const ageMs = Date.now() - (currentCommand.issuedAt || 0);
      const targetClientId = String(currentCommand.targetClientId || '');
      const targetUrl = String(currentCommand.targetUrl || '');
      const clientUrl = String(url.searchParams.get('url') || '');
      const sameUrl = !!targetUrl && !!clientUrl && targetUrl === clientUrl;
      // Be tolerant here. Some browsers/content scripts can re-create client IDs after
      // reloads, while the visible meeting tab is still the correct target. If a command
      // is queued and the polling tab is the selected URL (or no target is set), deliver it.
      const intendedClient = !targetClientId || (!!clientId && clientId === targetClientId) || sameUrl;
      const active = intendedClient && currentCommand.seq > lastSeq && currentCommand.action !== 'idle' && ageMs < 10 * 60 * 1000;
      if (active) {
        const deliveryKey = `${desktopSessionId}:${currentCommand.seq}:${clientId || clientUrl}`;
        if (!deliveredCommandLogKeys.has(deliveryKey)) {
          deliveredCommandLogKeys.add(deliveryKey);
          sendLog(`Extension command delivered: ${currentCommand.action} #${currentCommand.seq} voice=${currentCommand.micTxEnabled ? 'ON' : 'OFF'} to ${clientUrl || clientId || 'meeting tab'}`);
          if (deliveredCommandLogKeys.size > 200) deliveredCommandLogKeys.clear();
        }
      }
      writeJsonResponse(res, 200, {
        ok: true,
        sessionId: desktopSessionId,
        hasCommand: active,
        command: active ? currentCommand : { seq: currentCommand.seq, sessionId: desktopSessionId, action: 'idle' },
        serverUrl: `http://127.0.0.1:${settings.LOCAL_MEET_TRANSLATOR_PORT}`,
        authToken: settings.LOCAL_MEET_TRANSLATOR_TOKEN,
        clientId: currentCommand.targetClientId || clientId || ''
      });
      return;
    }

    if (url.pathname === '/extension-command/ack') {
      if (!requireExtensionToken(req, res, extensionToken)) return;
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (_) {}
        const seq = Number(data.seq || url.searchParams.get('seq') || '0');
        const action = String(data.action || url.searchParams.get('action') || '?');
        const ok = data.ok === undefined ? true : !!data.ok;
        const text = data.message || data.error || '';
        const clientId = String(data.clientId || '');
        const sessionId = String(data.sessionId || url.searchParams.get('sessionId') || '');
        const ackResult = extensionCommandCoordinator.acknowledge({
          seq,
          action,
          ok,
          message: text,
          details: data.details || {},
          clientId,
          sessionId
        });
        // The command sequence and desktop session scope the ACK to the current app.
        // Client IDs may legitimately change after a meeting-tab reload.
        if (!ackResult.ok) {
          writeJsonResponse(res, 400, { ok: false, error: ackResult.error });
          return;
        }
        if (ok && action === 'start' && clientId) extensionClientRegistry.markActive(clientId);
        if (action === 'stop') extensionClientRegistry.clearActive(clientId);
        sendLog(`Extension ${ok ? 'ACK' : 'ERROR'} for ${action} #${seq}${text ? ': ' + text : ''}`);
        writeJsonResponse(res, 200, { ok:true });
      });
      return;
    }

    writeJsonResponse(res, 404, { ok:false, error:'not found' });
  });
  configServer.on('error', (err) => {
    sendLog(`Extension config server failed on 127.0.0.1:18798: ${err.message}`);
    try {
      if (!appClosing) {
        appClosing = true;
        setTimeout(() => app.quit(), 200);
      }
    } catch (_) {}
  });
  configServer.listen(18798, '127.0.0.1', () => sendLog('Extension config/command server: http://127.0.0.1:18798'));
}
function initializeWindowManager() {
  windowManager = createWindowManager({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.js'),
    htmlPath: path.join(__dirname, 'index.html'),
    onCloseRequested: (event) => {
      if (appClosing) return;
      appClosing = true;
      event.preventDefault();
      issueExtensionCommand('stop');
      translationSession.stop();
      killProcessTree(bridgeProc, 'bridge');
      killProcessTree(voiceProc, 'voice');
      setTimeout(() => {
        try { if (configServer) configServer.close(); } catch (_) {}
        try { if (subtitleOverlay) subtitleOverlay.destroy(); } catch (_) {}
        try { windowManager.destroyMainWindow(); } catch (_) {}
        app.quit();
      }, 800);
    }
  });
  subtitleOverlay = createSubtitleOverlayController({
    BrowserWindow,
    screen,
    globalShortcut,
    desktopCapturer,
    preloadPath: path.join(__dirname, 'subtitle-preload.js'),
    htmlPath: path.join(__dirname, 'subtitle-overlay.html'),
    statePath: subtitleWindowStatePath,
    loadSettings,
    saveSettings,
    sendLog,
    platform: process.platform
  });
  subtitleOverlay.initialize();
  return windowManager.createMainWindow();
}
app.whenReady().then(() => {
  const migration = migrateLegacyEnvIfNeeded();
  initializeWindowManager();
  startConfigServer();
  setTimeout(() => {
    sendLog(`Config path: ${envPath}`);
    if (migration.migrated) sendLog(`Migrated legacy .env from: ${migration.source}`);
  }, 400);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  appClosing = true;
  try { if (windowManager && windowManager.getMainWindow()) issueExtensionCommand('stop'); } catch (_) {}
  translationSession.stop();
  killProcessTree(bridgeProc, 'bridge');
  killProcessTree(voiceProc, 'voice');
  try { if (configServer) configServer.close(); } catch (_) {}
  try { if (subtitleOverlay) subtitleOverlay.destroy(); } catch (_) {}
});

ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform, packaged: isPackaged }));
ipcMain.handle('session:status', () => translationSession.snapshot());
ipcMain.handle('subtitle-overlay:status', () => subtitleOverlay ? subtitleOverlay.snapshot() : { visible:false, status:'unavailable' });
ipcMain.handle('subtitle-overlay:control', async (_event, action, payload = {}) => {
  if (!subtitleOverlay) return { ok:false, message:'Subtitle window is not initialized.' };
  switch (String(action || '')) {
    case 'show': return subtitleOverlay.show();
    case 'hide': return subtitleOverlay.hide();
    case 'toggle': return subtitleOverlay.toggle();
    case 'clear': return subtitleOverlay.clear();
    case 'pause': return subtitleOverlay.setPaused(!!payload.paused);
    case 'clickThrough': return subtitleOverlay.setClickThrough(!!payload.enabled);
    case 'testProtection': return await subtitleOverlay.testContentProtection();
    case 'rehome': subtitleOverlay.rehome(); return { ok:true, ...subtitleOverlay.snapshot() };
    default: return { ok:false, message:`Unknown subtitle window action: ${String(action || '')}` };
  }
});
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_e, settings) => {
  const saved = saveSettings(settings);
  if (subtitleOverlay) subtitleOverlay.updateSettings(saved);
  return { ok:true, settings: saved, subtitle: subtitleOverlay ? subtitleOverlay.snapshot() : null, message: `Saved ${envPath}` };
});
ipcMain.handle('env:open', () => { if (!fs.existsSync(envPath)) saveSettings({}); shell.openPath(envPath); return { ok:true }; });
ipcMain.handle('extension:open', () => { shell.openPath(extensionPath); return { ok:true, message: extensionPath }; });
ipcMain.handle('bridge:start', () => startBridgeInternal());
ipcMain.handle('bridge:stop', () => { if (bridgeProc) { killProcessTree(bridgeProc, 'bridge'); bridgeProc = null; return { ok:true, message:'Bridge stopped.' }; } return { ok:true, message:'Bridge was not started by this app. If health still shows OK, an external bridge process is already running.' }; });
ipcMain.handle('voice:start', () => {
  if (voiceProc) return { ok:true, message:'Voice conversion is already running from this desktop app.' };
  const s = loadSettings();
  const host = s.VOICE_CONVERSION_HOST || '127.0.0.1';
  const port = s.VOICE_CONVERSION_PORT || '18799';
  const bundledVoice = findVoiceExecutable();
  if (bundledVoice) {
    voiceProc = spawnLogged(bundledVoice, ['--host', host, '--port', port], { cwd: path.dirname(bundledVoice), env: { ...process.env, ...s } }, 'voice');
  } else {
    if (isPackaged) return { ok:false, message:'Bundled voice conversion service not found. Reinstall the application.' };
    const server = path.join(repoRoot, 'voice-conversion', 'server.py');
    if (!fs.existsSync(server)) return { ok:false, message:'voice-conversion/server.py not found.' };
    const py = process.platform === 'win32' ? 'python' : 'python3';
    voiceProc = spawnLogged(py, ['-m', 'uvicorn', 'server:app', '--host', host, '--port', port], { cwd: path.dirname(server), env: { ...process.env, ...s } }, 'voice');
  }
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

ipcMain.handle('extension:startTranslation', async (_event, options = {}) => {
  const opts = options || {};
  const requestedMode = opts.mode === 'voice' || opts.micTxEnabled === true ? 'voice' : 'subtitles';
  sendLog(`UI requested ${requestedMode} translation.`);
  try { translationSession.prepare(requestedMode === 'voice' ? 'live_voice_translation' : 'live_subtitles'); } catch (error) { return { ok:false, state:'invalid-state', message:error.message }; }
  const s = loadSettings();
  let b = await requestJson(`http://127.0.0.1:${s.LOCAL_MEET_TRANSLATOR_PORT}/health`, s.LOCAL_MEET_TRANSLATOR_TOKEN);
  if (!b.ok) {
    sendLog(`Bridge is not ready (${b.status || 0}: ${b.body || 'offline'}). Attempting automatic start...`);
    const started = startBridgeInternal();
    sendLog(started.message);
    if (!started.ok) { translationSession.markError(started.message); return { ok:false, state:'bridge-error', message:started.message }; }
    b = await waitForBridgeReady(s);
  }
  if (!b.ok) {
    const hint = b.status === 401
      ? 'Another old bridge is probably running with a different token. Close old Local Meet Translator/Java processes and try again.'
      : 'Check the bridge log and OPENAI_API_KEY.';
    translationSession.markError(`Bridge is not ready: ${b.body || 'offline'}`);
    return { ok:false, state:'bridge-error', message:`Bridge is not ready: ${b.body || 'offline'}. ${hint}` };
  }
  const clients = getRecentExtensionClients();
  if (!clients.length) {
    sendLog('No paired Meet/Zoom/Teams background client seen yet. Pair the extension, then open the meeting tab and press Connect this meeting tab once.');
    translationSession.markError('No meeting tab is connected.');
    return { ok:false, state:'tab-missing', message:'No meeting tab is connected. Open the extension on the active Meet/Zoom/Teams tab and click Connect this meeting tab.' };
  }
  const voiceMode = opts.mode === 'voice' || opts.micTxEnabled === true;
  const subtitleMode = opts.mode === 'subtitles' || opts.micTxEnabled === false;
  const commandOverrides = {};
  if (voiceMode) {
    commandOverrides.micTxEnabled = true;
    commandOverrides.audioIsolationMode = true;
    commandOverrides.ttsEnabled = false;
    commandOverrides.micDeviceId = String(opts.micDeviceId || s.EXT_MIC_DEVICE_ID || '');
    commandOverrides.micDeviceName = String(opts.micDeviceName || s.EXT_MIC_DEVICE_NAME || '');
    commandOverrides.ttsSinkDeviceId = String(opts.ttsSinkDeviceId || s.EXT_TTS_SINK_DEVICE_ID || '');
    commandOverrides.ttsSinkDeviceName = String(opts.ttsSinkDeviceName || s.EXT_TTS_SINK_DEVICE_NAME || 'CABLE Input');
    commandOverrides.micTxSourceLang = String(opts.micTxSourceLang || s.EXT_MIC_TX_SOURCE_LANG || getSystemLanguageCode());
    commandOverrides.micTxTargetLang = String(opts.micTxTargetLang || s.EXT_MIC_TX_TARGET_LANG || 'en');
    commandOverrides.micTxChunkSeconds = intFromEnv(opts.micTxChunkSeconds || s.EXT_MIC_TX_CHUNK_SECONDS, 5, 2, 15);
    commandOverrides.outVoiceStyle = String(opts.outVoiceStyle || s.EXT_OUT_VOICE_STYLE || 'openai');
    commandOverrides.rvcModelTag = String(opts.rvcModelTag || s.EXT_RVC_MODEL_TAG || '');
    commandOverrides.showOutgoingSubtitles = !!opts.showOutgoingSubtitles || boolFromEnv(s.EXT_SHOW_OUTGOING_SUBTITLES, false);
  } else if (subtitleMode) {
    commandOverrides.micTxEnabled = false;
    commandOverrides.ttsEnabled = false;
  }
  const target = chooseExtensionClient();
  sendLog(`Selected meeting tab: ${target.url}`);
  const cmd = issueExtensionCommand('start', target, commandOverrides);
  const ack = await waitForExtensionAck(cmd.seq);
  if (!ack) {
    if (voiceMode) {
      const msg = 'The meeting tab did not confirm microphone/TTS readiness. Voice translation was not marked as running. Reopen the extension popup and check its log for a microphone or CABLE Input error.';
      sendLog(`[error] ${msg}`);
      translationSession.markError(msg);
      return {
        ok:false,
        state:'voice-timeout',
        message:msg,
        details:{ ackMissing:true, micTxEnabled:true, micTxReady:false, sinkReady:false },
        meetingUrl:target.url
      };
    }
    const msg = 'Subtitle command was delivered to the meeting tab, but ACK did not return. Treating it as started because the tab is connected and polling commands.';
    sendLog(`[warn] ${msg}`);
    translationSession.transition(SESSION_STATES.LISTENING);
    if (subtitleOverlay) { subtitleOverlay.setStatus('listening'); subtitleOverlay.show(); }
    return { ok:true, state:'running-unconfirmed', message:msg, details:{ ackMissing:true, incomingReady:true }, meetingUrl:target.url };
  }
  if (!ack.ok) { translationSession.markError(ack.text || 'The browser extension could not start translation.'); return { ok:false, state:'extension-error', message:ack.text || 'The browser extension could not start translation.', details:ack.details || {} }; }
  translationSession.transition(SESSION_STATES.LISTENING);
  if (subtitleOverlay) { subtitleOverlay.setStatus('listening'); subtitleOverlay.show(); }
  return { ok:true, state:'running', message:ack.text || 'Translation is running.', details:ack.details || {}, meetingUrl:target.url };
});
ipcMain.handle('extension:stopTranslation', async () => {
  if (!extensionClientRegistry.getActive() && !chooseExtensionClient()) {
    translationSession.stop();
    if (subtitleOverlay) subtitleOverlay.setStatus('idle');
    return { ok:true, state:'stopped', message:'Translation is already stopped.' };
  }
  if (![SESSION_STATES.IDLE, SESSION_STATES.COMPLETED, SESSION_STATES.STOPPING].includes(translationSession.state)) {
    translationSession.transition(SESSION_STATES.STOPPING);
  }
  const cmd = issueExtensionCommand('stop');
  const ack = await waitForExtensionAck(cmd.seq, 5000);
  if (!ack) {
    translationSession.markError('The meeting tab did not confirm stop.');
    return { ok:false, state:'timeout', message:'The meeting tab did not confirm stop.' };
  }
  if (ack.ok) {
    translationSession.stop();
    if (subtitleOverlay) subtitleOverlay.setStatus('idle');
  } else {
    translationSession.markError(ack.text || 'Could not stop translation.');
    if (subtitleOverlay) subtitleOverlay.setStatus('error');
  }
  return { ok:ack.ok, state:ack.ok ? 'stopped' : 'extension-error', message:ack.text || (ack.ok ? 'Translation stopped.' : 'Could not stop translation.') };
});
