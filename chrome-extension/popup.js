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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function checkDesktop() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "DESKTOP_HEALTH" });
    if (data && data.ok) {
      setText("desktopStatus", t("online"), "ok");
      log(t("desktopOnline"));
    } else {
      setText("desktopStatus", t("notReady"), "warn");
      log(t("desktopNotReady"));
    }
  } catch (_) {
    setText("desktopStatus", t("offline"), "err");
    log(t("desktopOffline"));
  }
}

async function pairDesktop() {
  const input = $("pairingCode");
  let code = input ? String(input.value || "").trim() : "";
  const btn = $("pairDesktop");
  try {
    if (btn) btn.disabled = true;
    if (!code) {
      await preloadPairingCode();
      code = input ? String(input.value || "").trim() : "";
    }
    const res = await chrome.runtime.sendMessage({ type: "PAIR_WITH_DESKTOP", pairingCode: code });
    if (res && res.ok) {
      setText("desktopStatus", t("paired"), "ok");
      log(t("pairedLog"));
      await checkDesktop();
    } else {
      setText("desktopStatus", t("notReady"), "err");
      log((res && (res.error || res.message)) || t("pairFailed"));
    }
  } catch (e) {
    setText("desktopStatus", t("notReady"), "err");
    log(String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function preloadPairingCode() {
  const input = $("pairingCode");
  if (!input) return;
  try {
    const data = await chrome.runtime.sendMessage({ type: "DESKTOP_PAIRING_CODE" });
    if (data && data.ok && data.pairingCode) {
      input.value = String(data.pairingCode || "");
      input.select?.();
      log(t("pairingCodeLoaded"));
      return true;
    }
  } catch (_) {}
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
    const res = await chrome.runtime.sendMessage({ type: "ARM_CURRENT_TAB", tabId: tab.id });
    if (res && res.ok) {
      setText("runtimeStatus", t("connected"), "ok");
      log(t("connectedLog"));
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


async function autoPairAndCheckDesktop() {
  await preloadPairingCode();
  await checkDesktop();
  const status = $("desktopStatus");
  if (status && status.className === "ok") return;
  const input = $("pairingCode");
  if (input && input.value.trim()) {
    await pairDesktop();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  setText("runtimeStatus", t("idle"), "warn");
  await autoPairAndCheckDesktop();
  let attempts = 0;
  const retry = setInterval(async () => {
    attempts += 1;
    const input = $("pairingCode");
    if (input && input.value.trim()) {
      clearInterval(retry);
      return;
    }
    if (attempts >= 20) {
      clearInterval(retry);
      return;
    }
    await preloadPairingCode();
  }, 250);
  const tab = await checkCurrentPage();
  const btn = $("connectTab");
  if (btn) btn.onclick = connectCurrentMeetingTab;
  const pairBtn = $("pairDesktop");
  if (pairBtn) pairBtn.onclick = pairDesktop;
  const audioAccess = $("audioAccess");
  if (audioAccess) audioAccess.onclick = () => chrome.runtime.openOptionsPage();
  if (tab) await connectCurrentMeetingTab();

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "STATUS") {
        const kind = msg.kind || "idle";
        const cls = kind === "ok" || kind === "run" ? "ok" : (kind === "err" ? "err" : "warn");
        setText("runtimeStatus", msg.text || kind, cls);
        if (msg.log) log(msg.log);
      }
    });
  } catch (_) {}
});
