# Установка ApePatrol в Firefox

## Обычная установка

1. Откройте GitHub Releases репозитория.
2. Скачайте **подписанный** `apepatrol-<version>-firefox.xpi`.
3. Откройте XPI в Firefox 140+ и подтвердите установку.
4. Откройте настройки ApePatrol.
5. В **MaxPatrol SIEM instances** введите только origin, например `https://siem.example.internal`.
6. Нажмите **Grant exact-origin access** и подтвердите permission Firefox.

Developer Mode для подписанного release не нужен. Unsigned review ZIP не является пользовательской установкой.

## Обновления

Подписанный XPI имеет постоянный ID `apepatrol@isaiandco.local` и получает update manifest из `releases/latest/download/updates.json`. URL вычисляется из текущего `GITHUB_REPOSITORY`, поэтому переименование репозитория не требует правки исходников. XPI в manifest всегда указывает на versioned release asset и проверяется SHA-256.

## Внешние сервисы

1. В настройках сохраните нужные API-ключи — само сохранение ничего не отправляет.
2. Отдельной кнопкой выдайте Firefox разрешение на передачу IOC и API-ключей.
3. Отдельной кнопкой разрешите точный endpoint каждого нужного провайдера.
4. В карточке события нажмите обезьянку у конкретного IP, хеша, домена или URL и выберите провайдера либо соберите batch в popup.

VirusTotal, AbuseIPDB, Kaspersky OpenTIP и ThreatFox включаются независимо. Firefox не позволяет объединять optional-only data-collection consent с host permission, поэтому это намеренно два отдельных пользовательских действия. Batch до отправки показывает каждую пару IOC/provider, требует подтверждение, ограничивает параллелизм, повторяет только временные ошибки/HTTP 429 и возвращает частичные результаты. Успешные ответы помещаются в настраиваемый TTL cache; API-ключи в cache не записываются.

Для AI отдельно разрешается точный endpoint. Перед отправкой нажмите «Сформировать точный payload»: popup покажет фактическое JSON-тело, UTF-8 размер и эвристические предупреждения. Отправка разрешается только для неизменившегося SHA-256 preview и требует отдельного подтверждения; эти эвристики не являются DLP.

## Граф процессов

Popup получает небольшой seed-контекст и сохраняет versioned snapshot в `storage.session`, затем открывает отдельную вкладку графа. Кнопки expansion подгружают parents, children, siblings и соседние интервалы страницами; запрос можно отменить. Достижение лимита не является ошибкой и позволяет явно увеличить cap до 10 000 узлов. После закрытия исходной SIEM-вкладки локальные действия продолжают работать; можно подключить другую открытую вкладку того же origin.

## Investigation Workspace и Event Compare

В popup прикрепите текущее событие/host/account/incident, в меню IOC — IOC, а в process graph используйте правый клик по узлу. Отдельная страница **Investigation Workspace** хранит расследования локально в IndexedDB. Выберите 2–3 event items для сравнения. JSON/Markdown exports не читают `storage.local` secrets и пригодны для сохранения в тикет/отчёт.

## Enterprise Profiles

Options экспортирует versioned JSON только с non-secret settings и импортирует его в режиме merge или replace. Для централизованного rollout Firefox policy может задать managed defaults и locked paths. Формат и пример приведены в [docs/ENTERPRISE_PROFILES.md](docs/ENTERPRISE_PROFILES.md).

## Development-установка

```bash
npm ci
npm run build:firefox
```

Откройте `about:debugging` → **This Firefox** → **Load Temporary Add-on** и выберите `dist/firefox/manifest.json`.
