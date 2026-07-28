const sourceText = document.getElementById("source-text");
const translatedText = document.getElementById("translated-text");

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "LMT_TRANSLATE_SELECTION") return undefined;

  sourceText.classList.remove("error");
  translatedText.classList.remove("error");

  if (message.error) {
    sourceText.textContent = "Не удалось получить выделенный текст.";
    translatedText.textContent = message.error;
    translatedText.classList.add("error");
    return undefined;
  }

  const text = String(message.text || "").trim();
  if (!text) {
    sourceText.textContent = "Текст не выделен.";
    translatedText.textContent = "Выделите текст на странице и повторите команду.";
    return undefined;
  }

  sourceText.textContent = text;

  // Replace this mock with a real translator API request:
  // const response = await fetch("https://your-api.example/translate", { ... });
  // translatedText.textContent = (await response.json()).translation;
  translatedText.textContent = `[Имитация перевода] ${text}`;
  return undefined;
});

browser.runtime.sendMessage({ type: "LMT_SIDE_PANEL_READY" }).catch(() => {});
