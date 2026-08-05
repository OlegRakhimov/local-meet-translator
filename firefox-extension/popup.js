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
    const obj = await browser.storage.local.get([
      "desktopExtensionToken",
      "desktopExtensionClientId",
      "desktopExtensionSessionId",
      "desktopExtensionCommandSeq"
    ]);
    return {
      paired: !!obj.desktopExtensionToken,
      clientId: String(obj.desktopExtensionClientId || ""),
      sessionId: String(obj.desktopExtensionSessionId || ""),
      seq: Number(obj.desktopExtensionCommandSeq || 0) || 0
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
  const code = String(codeEl && codeEl.value || "").trim();
  const btn = $("pairDesktop");
  try {
    if (btn) btn.disabled = true;
    if (!code) {
      setText("runtimeStatus", t("pairingRequired"), "warn");
      log(t("pairingEnterCode"));
      return;
    }
    const res = await browser.runtime.sendMessage({ type: "PAIR_DESKTOP", pairingCode: code });
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

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  setText("runtimeStatus", t("idle"), "warn");
  renderPairStatus(await getPairingStatus());
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
        renderPairStatus({ paired: !!changes.desktopExtensionToken.newValue });
      }
    });
  } catch (_) {}
});
