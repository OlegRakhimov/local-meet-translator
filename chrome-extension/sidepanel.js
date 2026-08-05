const sourceText = document.getElementById("source-text");
const translatedText = document.getElementById("translated-text");

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "LMT_TRANSLATE_SELECTION") return;

  sourceText.classList.remove("error");
  translatedText.classList.remove("error");

  if (message.error) {
    sourceText.textContent = "Не удалось получить выделенный текст.";
    translatedText.textContent = message.error;
    translatedText.classList.add("error");
    return;
  }

  const text = String(message.text || "").trim();
  if (!text) {
    sourceText.textContent = "Текст не выделен.";
    translatedText.textContent = "Выделите текст на странице и повторите команду.";
    return;
  }

  sourceText.textContent = text;

  // Здесь можно заменить имитацию реальным запросом к API переводчика:
  // const response = await fetch("https://your-api.example/translate", { ... });
  // translatedText.textContent = (await response.json()).translation;
  translatedText.textContent = `[Имитация перевода] ${text}`;
});

// Устраняет гонку между загрузкой новой панели и первой отправкой сообщения.
chrome.runtime.sendMessage({ type: "LMT_SIDE_PANEL_READY" }).catch(() => {});
