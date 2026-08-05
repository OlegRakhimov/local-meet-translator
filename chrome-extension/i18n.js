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
      hint: "This popup only connects the current meeting tab. Start voice translation or subtitles from the clearly labelled buttons in the desktop app.",
      connectTab: "Connect this meeting tab",
      audioAccess: "Grant microphone / VB-Cable access",
      connected: "connected",
      connectOpenMeeting: "Open this popup from a Meet / Zoom / Teams tab.",
      connectedLog: "Meeting tab connected. Return to the desktop app and choose voice translation or subtitles.",
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
      hint: "Этот popup только подключает текущую вкладку встречи. Голосовой перевод или субтитры запускаются отдельными понятными кнопками в desktop-приложении.",
      connectTab: "Подключить эту вкладку встречи",
      audioAccess: "Дать доступ к микрофону / VB-Cable",
      connected: "подключено",
      connectOpenMeeting: "Открой popup именно на вкладке Meet / Zoom / Teams.",
      connectedLog: "Вкладка встречи подключена. Вернитесь в desktop-приложение и выберите голосовой перевод или субтитры.",
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
  Object.assign(S.en, {
    pairingCode: "Pairing code",
    pairDesktop: "Pair with desktop",
    paired: "paired",
    pairedLog: "Desktop extension token stored in browser.storage.local.",
    pairFailed: "Could not pair with desktop.",
    pairingCodeLoaded: "Pairing code loaded from the desktop app."
  });
  Object.assign(S.ru, {
    pairingCode: "Код pairing",
    pairDesktop: "Соединить с desktop",
    paired: "соединено",
    pairedLog: "Desktop extension token сохранён в browser.storage.local.",
    pairFailed: "Не удалось соединиться с desktop.",
    pairingCodeLoaded: "Код pairing загружен из desktop-приложения."
  });
  for (const l of ["pl", "de", "es", "it"]) S[l] = S.en;
  window.LMT_I18N = { lang, t: (k) => (S[lang] && S[lang][k]) || S.en[k] || k };
  window.lmtText = (k) => window.LMT_I18N.t(k);
})();
