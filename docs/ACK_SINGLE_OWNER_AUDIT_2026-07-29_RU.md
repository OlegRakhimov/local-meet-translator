# Аудит ACK и дублирования — 29.07.2026

## Исправленная проблема

Для Chromium-расширений подтверждение команды теперь принадлежит только `background.js`.

Новая цепочка:

```text
Desktop -> content_script.js -> background.js -> offscreen.js
                                      |
                                      +-> один ACK -> Desktop
```

`content_script.js` больше не создаёт и не отправляет `DESKTOP_COMMAND_ACK`. Он только:

1. получает команду через polling;
2. передаёт её в background;
3. после ответа background сохраняет `lastSeq` и `lastCommandKey`;
4. при недоставленном ACK не двигает курсор и повторяет синхронизацию.

Для уже открытых вкладок со старым content script сообщение `DESKTOP_COMMAND_ACK` принимается background в режиме совместимости, но игнорируется и не пересылается в Desktop.

## Дополнительные исправления

- Chrome и Edge используют одинаковые `background.js` и `content_script.js`; архитектурный тест теперь запрещает их расхождение.
- В Chrome добавлен тот же долговечный курсор команд, который уже был в Edge: `desktopExtensionCommandSeq`, `lastProcessedSeq`, защита от повторного выполнения после перезапуска Manifest V3 service worker.
- В Chrome синхронизирована передача blur/visibility-состояния вкладки, чтобы скрытая вкладка не оставалась активным клиентом.
- `ExtensionCommandCoordinator.acknowledge()` стал идемпотентным: поздний конфликтующий ACK не перезаписывает первый принятый результат.
- Endpoint `/extension-command/ack` больше не создаёт повторные логи и повторные побочные эффекты для duplicate ACK.
- ACK команды `release` очищает активного клиента так же, как `stop`.
- Исправлена устаревшая проверка Stage 16: workflow использует `scripts/windows/install-poppler.ps1`, а не нерабочий `choco install poppler`.

## Изменённые файлы

- `chrome-extension/background.js`
- `chrome-extension/content_script.js`
- `edge-extension/background.js`
- `edge-extension/content_script.js`
- `desktop-app/src/main/extension-state.js`
- `desktop-app/src/main.js`
- `desktop-app/test/extension-state.test.js`
- `scripts/tests/validate-chromium-extension.js`
- `scripts/tests/validate-stage16-document-compliance-release.js`

## Проверки

- Desktop unit tests: **96 passed, 0 failed**.
- Все architecture validators: **passed**.
- Новый тест подтверждает, что поздний `ok=false` duplicate ACK не перезаписывает ранее принятый `ok=true`.
- `node --check`: все JS-файлы проекта прошли синтаксическую проверку.
- `python -m py_compile voice-conversion/server.py`: успешно.
- Java-файлы не изменялись. Maven в изолированном контейнере повторно не запускался, потому что Maven Wrapper пытался скачать Maven из сети, а внешняя сеть контейнера недоступна.

## Найденный лишний/устаревший код, не удалённый этим патчем

Статический поиск определений без вызовов нашёл следующие высоковероятные остатки предыдущих реализаций:

1. `flushMicSegment()` в:
   - `chrome-extension/offscreen.js`;
   - `edge-extension/offscreen.js`;
   - `firefox-extension/firefox_audio.js`.

   После перехода на whole-phrase `MediaRecorder` эти функции не вызываются. Связанные `micSegmentParts` и `micSegmentMime` также выглядят как устаревшее состояние. Удалять лучше отдельным cleanup-коммитом после ручной проверки голосового режима во всех трёх браузерах.

2. `requireExtensionOrigin()` в `desktop-app/src/main.js` не вызывается. Проверка origin выполняется напрямую в `startConfigServer()`. Это не уязвимость, а лишняя обёртка.

3. `normalizeOrigin()` и `stopDesktopPolling()` в `firefox-extension/background.js` не вызываются.

4. Параметр/поле `logger` в `ExtensionCommandCoordinator` сейчас не используется.

Автоматический поиск не обнаружил повторных top-level объявлений функций в активном JavaScript-коде. Одинаковые файлы Chrome/Edge являются упаковочными копиями, а не двумя одновременно выполняющимися реализациями; теперь их идентичность контролируется тестом.

## Рекомендация по следующему cleanup

Не смешивать удаление устаревшего аудиокода с ACK-патчем. Сначала проверить текущий патч на реальной встрече: `start`, смена voice/subtitles, `stop`, повторный `start`, `release`. Затем отдельным коммитом удалить четыре неиспользуемых функции/обёртки и мёртвые поля микрофонного сегмента.
