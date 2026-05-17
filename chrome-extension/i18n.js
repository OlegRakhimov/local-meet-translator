(() => {
  const supported = new Set(["ru", "pl", "de", "es", "it"]);
  const code = String(navigator.language || "en").toLowerCase().split("-")[0];
  const lang = supported.has(code) ? code : "en";
  const S = {
    en: {
      installed: "Open this popup once from the meeting tab to grant capture access. Translation is then controlled from the desktop app.",
      desktop: "Desktop command server",
      page: "Current page",
      state: "Last extension state",
      hint: "Open this popup on the Meet / Zoom / Teams tab first, then use Start bridge and Start translation in the desktop app.",
      connectTab: "Connect this meeting tab",
      connected: "connected",
      connectOpenMeeting: "Open this popup from a Meet / Zoom / Teams tab.",
      connectedLog: "Meeting tab connected. You can now start translation in the desktop app.",
      connectFailed: "Could not connect this tab.",
      checking: "checking...",
      idle: "idle",
      online: "online",
      notReady: "not ready",
      offline: "offline",
      meetingPage: "meeting page",
      notMeetingPage: "not a meeting page",
      unknown: "unknown",
      cannotRead: "cannot read",
      desktopOnline: "Desktop app command server is online.",
      desktopNotReady: "Desktop app command server replied, but is not ready.",
      desktopOffline: "Desktop app is not running or command server is offline.",
      drag: "Local Meet Translator - drag",
      heard: "Heard",
      you: "You"
    },
    ru: {
      installed: "Открой этот popup один раз на вкладке встречи, чтобы дать доступ к захвату вкладки. Потом перевод управляется из desktop-приложения.",
      desktop: "Desktop command server",
      page: "Текущая страница",
      state: "Состояние расширения",
      hint: "Сначала открой popup на вкладке Meet / Zoom / Teams, затем запускай bridge и перевод в desktop-приложении.",
      connectTab: "Подключить эту вкладку встречи",
      connected: "подключено",
      connectOpenMeeting: "Открой popup именно на вкладке Meet / Zoom / Teams.",
      connectedLog: "Вкладка встречи подключена. Теперь можно запускать перевод в desktop-приложении.",
      connectFailed: "Не удалось подключить вкладку.",
      checking: "проверка...",
      idle: "ожидание",
      online: "online",
      notReady: "не готово",
      offline: "offline",
      meetingPage: "страница встречи",
      notMeetingPage: "не страница встречи",
      unknown: "неизвестно",
      cannotRead: "нет доступа",
      desktopOnline: "Desktop command server online.",
      desktopNotReady: "Desktop command server ответил, но не готов.",
      desktopOffline: "Desktop не запущен или command server offline.",
      drag: "Local Meet Translator - перетащи",
      heard: "Распознано",
      you: "Ты"
    }
  };
  for (const l of ["pl", "de", "es", "it"]) S[l] = S.en;
  window.LMT_I18N = { lang, t: (k) => (S[lang] && S[lang][k]) || S.en[k] || k };
  window.lmtText = (k) => window.LMT_I18N.t(k);
})();
