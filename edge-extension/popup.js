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
    const resp = await fetch("http://127.0.0.1:18798/health", { cache: "no-store" });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok) {
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

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  setText("runtimeStatus", t("idle"), "warn");
  await checkDesktop();
  const tab = await checkCurrentPage();
  const btn = $("connectTab");
  if (btn) btn.onclick = connectCurrentMeetingTab;
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
