# Local Meet Translator — инструкция на русском

Local Meet Translator — локальный переводчик для веб-встреч. Управление находится в desktop-приложении, расширение браузера служит тонким клиентом: показывает статус, получает команды от desktop и рисует субтитры поверх Meet / Zoom / Teams.

## 1. Что умеет приложение

- Показывает перевод речи собеседника в субтитрах поверх встречи.
- Может озвучивать входящий перевод локально для тебя.
- Может переводить твою речь голосом для собеседника: твой микрофон → распознавание → перевод → TTS → виртуальный кабель → микрофон встречи.
- Поддерживает Chrome, Edge и Firefox отдельными папками расширений.
- Хранит OpenAI API key локально в desktop-приложении, а не в расширении.
- Поддерживает обычный OpenAI TTS и опциональный RVC / voice conversion, если у тебя запущен отдельный voice-conversion server и есть обученная модель.

## 2. Структура проекта

```text
local-meet-translator/
  desktop-app/              Electron desktop app
  local-meet-bridge/         Java bridge для OpenAI API
  chrome-extension/          расширение для Chrome
  edge-extension/            расширение для Edge
  firefox-extension/         расширение для Firefox
  voice-conversion/          опциональный сервер RVC / voice conversion
  docs/                      дополнительные материалы / landing page
  INSTALL_DESKTOP_WINDOWS.cmd
  RUN_DESKTOP_DEV.cmd
  README_RU.md
  README_EN.md
```

## 3. Требования

Для обычного использования на Windows:

- Windows 10 / 11.
- Node.js LTS — нужен для сборки desktop-инсталлятора.
- Java 17+ — нужен для bridge.
- Google Chrome, Microsoft Edge или Firefox.
- OpenAI API key.
- VB-Audio Virtual Cable или аналогичный virtual audio cable — нужен только если собеседник должен слышать твой голосовой перевод.

Для разработки bridge дополнительно нужен Maven, если ты пересобираешь `local-meet-bridge` вручную.

## 4. Установка desktop-приложения на Windows

1. Распакуй архив проекта.
2. Запусти двойным кликом:

```text
INSTALL_DESKTOP_WINDOWS.cmd
```

Скрипт выполнит сборку desktop-приложения и создаст установщик в папке:

```text
desktop-app\dist\
```

Запускай установщик вида:

```text
Local Meet Translator-1.0.0-Setup-x64.exe
```

После установки появится ярлык **Local Meet Translator** на рабочем столе и в меню «Пуск».

Конфиг хранится здесь:

```text
%APPDATA%\Local Meet Translator\.env
```

Обычно это:

```text
C:\Users\<user>\AppData\Roaming\Local Meet Translator\.env
```

## 5. Установка расширений

Popup расширения не управляет переводом. Он только показывает статус. Start / Stop находятся в desktop-приложении.

### Chrome

1. Открой `chrome://extensions`.
2. Включи **Developer mode**.
3. Нажми **Load unpacked**.
4. Выбери папку:

```text
chrome-extension
```

### Edge

1. Открой `edge://extensions`.
2. Включи **Developer mode**.
3. Нажми **Load unpacked**.
4. Выбери папку:

```text
edge-extension
```

### Firefox

1. Открой `about:debugging#/runtime/this-firefox`.
2. Нажми **Load Temporary Add-on**.
3. Выбери файл:

```text
firefox-extension/manifest.json
```

Важно: после замены файлов расширения всегда нажимай **Reload** на странице расширений и перезагружай вкладку Meet / Zoom / Teams.

## 6. Первый запуск

1. Открой desktop-приложение.
2. Вставь `OpenAI API key`.
3. Нажми **Save .env** / **Сохранить .env**.
4. Нажми **Start bridge** / **Запустить bridge**.
5. Открой вкладку Meet / Zoom / Teams.
6. Нажми в desktop:

```text
Start translation in browser
```

или в русской локализации:

```text
Запустить перевод в браузере
```

Popup расширения трогать не нужно.

## 7. Настройки языков

Дефолтный язык входящего перевода — английский:

```text
Incoming target language = en
```

Поддерживаемые удобные значения:

```text
en — English
ru — Russian
pl — Polish
de — German
es — Spanish
it — Italian
auto — автоопределение языка источника
```

Рекомендуемая настройка для входящих субтитров:

```text
Incoming source language = auto
Incoming target language = en или нужный тебе язык
```

Для твоего голосового перевода собеседнику:

```text
Я говорю на языке = ru / pl / de / es / it / en
Собеседник слышит язык = en / ru / pl / de / es / it
```

## 8. Субтитры для тебя

Для субтитров нужен блок входящего перевода:

```text
Incoming source language = auto
Incoming target language = нужный язык субтитров
Speak incoming translations locally = OFF, если не хочешь слышать озвучку себе
```

Потом:

```text
Start bridge
Start translation in browser
```

Субтитры появляются поверх Meet / Zoom / Teams в overlay **Local Meet Translator**.

## 9. Голосовой перевод собеседнику

Это отдельная функция. Она нужна, чтобы собеседник слышал не твой оригинальный голос, а переведённую речь.

Правильный маршрут:

```text
Твой реальный микрофон
→ Local Meet Translator
→ перевод
→ TTS
→ CABLE Input
→ CABLE Output
→ микрофон Google Meet / Zoom / Teams
→ собеседник
```

### Настройки в desktop

В блоке голосового перевода собеседнику:

```text
ON: мой микрофон → перевод → голос в конференцию = ON
Я говорю на языке = твой язык, например ru
Собеседник слышит язык = язык собеседника, например en
Название моего микрофона содержит = Realtek / Mikrofon / USB / Headset
Название выхода переведённого голоса содержит = CABLE Input
Дополнительно: device ID микрофона = обычно пусто
Дополнительно: device ID выхода TTS = обычно пусто
```

Не ставь `CABLE Output` как микрофон в поле **Название моего микрофона содержит**. Это поле должно указывать на твой реальный микрофон.

### Настройки в Google Meet

В Google Meet → Settings → Audio:

```text
Microphone = CABLE Output
Speakers = обычные наушники или динамики
```

То есть:

```text
Desktop выводит TTS в CABLE Input.
Meet берёт микрофон из CABLE Output.
```

Если Meet оставлен на обычном микрофоне, собеседник не услышит переведённый голос.

## 10. Voice conversion / RVC

Voice conversion — это не перевод и не TTS. Это дополнительный этап, который меняет уже сгенерированный TTS-голос на голос из обученной модели.

Обычный режим без RVC:

```text
речь → перевод → OpenAI TTS → собеседник слышит обычный синтетический голос
```

Режим с RVC:

```text
речь → перевод → OpenAI TTS → RVC-модель → собеседник слышит голос, похожий на твою модель
```

Для обычного голосового перевода собеседнику RVC не нужен. Рекомендуемая настройка:

```text
Enable TTS for outgoing translated voice = ON
Enable voice conversion / RVC hook = OFF
Outgoing voice style = OpenAI voice
```

Включай RVC только если у тебя есть обученная модель и запущен voice-conversion server.

## 11. Обновление проекта

Если обновлялся desktop:

1. Закрой Local Meet Translator.
2. Заверши старые процессы `java.exe`, `javaw.exe`, `node.exe`, `electron.exe`, если они остались.
3. Удали старое приложение через Windows → Apps → Installed apps.
4. Запусти `INSTALL_DESKTOP_WINDOWS.cmd`.
5. Установи новый `.exe` из `desktop-app\dist`.
6. Reload расширения в браузере.
7. Перезагрузи вкладку встречи.

Если обновлялись только расширения:

1. Останови перевод в desktop.
2. Замени папку нужного расширения.
3. Нажми **Reload** на странице расширений браузера.
4. Перезагрузи вкладку встречи.
5. Запусти перевод из desktop.

## 12. Частые проблемы

### Popup показывает кнопки Start / Connect

Загружена старая папка расширения. Удали расширение и заново загрузи правильную папку:

```text
chrome-extension / edge-extension / firefox-extension
```

### В логе: Extension has not been invoked for the current page

Активная вкладка не является Meet / Zoom / Teams, либо браузер не дал `activeTab`. Открой реальную вкладку встречи, перезагрузи её и нажми Start translation из desktop.

### Субтитры есть, но собеседник не слышит голосовой перевод

Проверь маршрут:

```text
Desktop: Название выхода переведённого голоса содержит = CABLE Input
Meet: Microphone = CABLE Output
Desktop: Название моего микрофона содержит = Realtek / Mikrofon / USB / Headset
```

`CABLE Output` должен быть выбран в Meet, а не как реальный микрофон для распознавания твоей речи.

### Ты слышишь перевод сам, а собеседник нет

TTS идёт не в `CABLE Input`, а в обычные динамики. Укажи:

```text
Название выхода переведённого голоса содержит = CABLE Input
```

### Голос собеседнику идёт короткими кусками

В этой версии outgoing voice собирает речь до короткой паузы и отправляет фразу целиком. Если всё ещё режет речь, увеличь `Mic chunk seconds` до `5` и говори с паузой после законченного предложения.

### Voice conversion красный / ECONNREFUSED

Voice-conversion server не запущен. Для обычного перевода выключи RVC:

```text
Enable voice conversion / RVC hook = OFF
Outgoing voice style = OpenAI voice
```

## 13. Безопасность

OpenAI API key хранится локально в `.env` desktop-приложения. Он не должен попадать в расширение и не должен быть включён в архивы для передачи другим людям.
