const $ = (id) => document.getElementById(id);
const t = (key) => (window.LMT_I18N && window.LMT_I18N.t(key)) || key;
function applyI18n() { document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); }); }

function setText(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = cls || "";
}

function log(msg) {
  const el = $("log");
  if (!el) return;
  const now = new Date().toLocaleTimeString();
  el.textContent += `[${now}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function isSupportedMeetingUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.startsWith("https://meet.google.com/")
    || u.includes(".zoom.us/")
    || u.startsWith("https://app.zoom.us/")
    || u.startsWith("https://teams.microsoft.com/")
    || u.startsWith("https://teams.live.com/");
}

async function getPairingStatus() {
  try {
    const obj = await browser.runtime.sendMessage({ type: "GET_PAIR_STATUS" });
    return {
      paired: !!(obj && obj.ok && obj.paired),
      clientId: String(obj.extensionClientId || obj.desktopExtensionClientId || ""),
      sessionId: String(obj.desktopSessionId || obj.desktopExtensionSessionId || ""),
      seq: Number(obj.desktopCommandSeq || obj.desktopExtensionCommandSeq || 0) || 0
    };
  } catch (_) {
    return { paired: false, clientId: "", sessionId: "", seq: 0 };
  }
}

function renderPairStatus(status) {
  const paired = !!(status && status.paired);
  setText("pairStatus", paired ? t("paired") : t("notPaired"), paired ? "ok" : "warn");
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function preloadPairingCode() {
  const input = $("pairingCode");
  if (!input) return false;
  input.value = "";
  try {
    const data = await browser.runtime.sendMessage({ type: "DESKTOP_PAIRING_CODE" });
    if (data && data.ok && data.pairingCode) {
      input.value = String(data.pairingCode || "");
      input.select?.();
      log(t("pairingCodeLoaded"));
      return true;
    }
  } catch (_) {}
  return false;
}

async function checkDesktop() {
  try {
    const result = await browser.runtime.sendMessage({ type: "DESKTOP_HEALTH" });
    if (result && result.ok) {
      renderPairStatus({ paired: true });
      return true;
    }
  } catch (_) {}
  renderPairStatus(await getPairingStatus());
  return false;
}

async function checkCurrentPage() {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
      setText("pageStatus", t("unknown"), "warn");
      return null;
    }
    if (isSupportedMeetingUrl(tab.url)) {
      setText("pageStatus", t("meetingPage"), "ok");
      return tab;
    } else {
      setText("pageStatus", t("notMeetingPage"), "warn");
      return null;
    }
  } catch (e) {
    setText("pageStatus", t("cannotRead"), "warn");
    return null;
  }
}

async function connectCurrentMeetingTab() {
  const btn = $("connectTab");
  try {
    if (btn) btn.disabled = true;
    const tab = await checkCurrentPage();
    if (!tab || !tab.id) {
      setText("runtimeStatus", t("notMeetingPage"), "warn");
      log(t("connectOpenMeeting"));
      return;
    }
    const res = await browser.runtime.sendMessage({ type: "ARM_CURRENT_TAB", tabId: tab.id });
    if (res && res.ok) {
      if (res.paired) {
        setText("runtimeStatus", t("connected"), "ok");
        log(t("connectedLog"));
      } else {
        setText("runtimeStatus", t("pairingRequired"), "warn");
        log(t("pairingEnterCode"));
      }
    } else {
      setText("runtimeStatus", t("notReady"), "err");
      log((res && (res.error || res.message)) || t("connectFailed"));
    }
  } catch (e) {
    setText("runtimeStatus", t("notReady"), "err");
    log(String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function pairDesktop() {
  const codeEl = $("pairingCode");
  let code = String(codeEl && codeEl.value || "").trim();
  const btn = $("pairDesktop");
  try {
    if (btn) btn.disabled = true;
    if (!code) {
      await preloadPairingCode();
      code = String(codeEl && codeEl.value || "").trim();
      if (!code) {
        setText("runtimeStatus", t("pairingRequired"), "warn");
        log(t("pairingEnterCode"));
        return;
      }
    }
    const res = await browser.runtime.sendMessage({ type: "PAIR_WITH_DESKTOP", pairingCode: code });
    if (res && res.ok) {
      const status = await getPairingStatus();
      renderPairStatus(status);
      setText("runtimeStatus", t("paired"), "ok");
      log(t("pairingSuccess"));
    } else {
      setText("runtimeStatus", t("pairingFailed"), "err");
      log((res && (res.error || res.message)) || t("pairingFailed"));
    }
  } catch (e) {
    setText("runtimeStatus", t("pairingFailed"), "err");
    log(String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function autoPairAndCheckDesktop() {
  const input = $("pairingCode");
  try {
    const synced = await browser.runtime.sendMessage({ type: "SYNC_WITH_DESKTOP" });
    if (synced && synced.ok && synced.pairingCode) {
      if (input) input.value = String(synced.pairingCode || "");
      if (await checkDesktop()) {
        setText("runtimeStatus", t("paired"), "ok");
        return true;
      }
    }
  } catch (_) {}
  await preloadPairingCode();
  if (await checkDesktop()) {
    setText("runtimeStatus", t("paired"), "ok");
    return true;
  }
  if (input && input.value.trim()) {
    await pairDesktop();
    return checkDesktop();
  }
  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  setText("runtimeStatus", t("idle"), "warn");
  renderPairStatus(await getPairingStatus());
  await autoPairAndCheckDesktop();
  let pairingAttempts = 0;
  const pairingRetry = setInterval(async () => {
    pairingAttempts += 1;
    if (pairingAttempts >= 8) {
      clearInterval(pairingRetry);
      return;
    }
    if (await autoPairAndCheckDesktop()) {
      clearInterval(pairingRetry);
    }
  }, 500);
  const tab = await checkCurrentPage();
  const btn = $("connectTab");
  if (btn) btn.onclick = connectCurrentMeetingTab;
  const pairBtn = $("pairDesktop");
  if (pairBtn) pairBtn.onclick = pairDesktop;
  const pairingCode = $("pairingCode");
  if (pairingCode) pairingCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairDesktop();
  });
  const audioAccess = $("audioAccess");
  if (audioAccess) audioAccess.onclick = () => browser.runtime.openOptionsPage();
  if (tab) await connectCurrentMeetingTab();

  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "STATUS") {
        const kind = msg.kind || "idle";
        const cls = kind === "ok" || kind === "run" ? "ok" : (kind === "err" ? "err" : "warn");
        setText("runtimeStatus", msg.text || kind, cls);
        if (msg.log) log(msg.log);
      }
    });
  } catch (_) {}

  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes) return;
      if (changes.desktopExtensionToken) {
        getPairingStatus().then(renderPairStatus).catch(() => {
          renderPairStatus({ paired: false });
        });
      }
    });
  } catch (_) {}
});
