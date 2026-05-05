(() => {
  const supported = new Set(["ru", "pl", "de", "es", "it"]);
  const code = String(navigator.language || "en").toLowerCase().split("-")[0];
  const lang = supported.has(code) ? code : "en";
  const S = {
    en: { installed: "Extension installed. Translation is controlled only from the desktop app.", desktop: "Desktop command server", page: "Current page", state: "Last extension state", hint: "Open Meet / Zoom / Teams, then press Start bridge and Start translation in the desktop app. This popup has no start, stop, tab connect, or settings buttons.", checking: "checking...", idle: "idle", online: "online", notReady: "not ready", offline: "offline", meetingPage: "meeting page", notMeetingPage: "not a meeting page", unknown: "unknown", cannotRead: "cannot read", desktopOnline: "Desktop app command server is online.", desktopNotReady: "Desktop app command server replied, but is not ready.", desktopOffline: "Desktop app is not running or command server is offline.", drag: "Local Meet Translator — drag", heard: "Heard", you: "You" },
    ru: { installed: "Расширение установлено. Управление переводом выполняется только из desktop-приложения.", desktop: "Desktop command server", page: "Текущая страница", state: "Последнее состояние расширения", hint: "Открой Meet / Zoom / Teams, затем в desktop-приложении нажми Start bridge и Start translation. В этом popup нет кнопок запуска, остановки, подключения вкладки и настроек.", checking: "проверка...", idle: "ожидание", online: "online", notReady: "не готов", offline: "offline", meetingPage: "страница встречи", notMeetingPage: "не страница встречи", unknown: "неизвестно", cannotRead: "нет доступа", desktopOnline: "Desktop command server online.", desktopNotReady: "Desktop command server ответил, но не готов.", desktopOffline: "Desktop не запущен или command server offline.", drag: "Local Meet Translator — перетащи", heard: "Распознано", you: "Ты" }
  };
  for (const l of ["pl","de","es","it"]) S[l] = S.en;
  window.LMT_I18N = { lang, t: (k) => (S[lang] && S[lang][k]) || S.en[k] || k };
  window.lmtText = (k) => window.LMT_I18N.t(k);
})();
