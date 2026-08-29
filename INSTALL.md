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
4. В карточке события нажмите обезьянку у конкретного IP, хеша, домена или URL и выберите провайдера.

VirusTotal, AbuseIPDB, Kaspersky OpenTIP и ThreatFox включаются независимо. Firefox не позволяет объединять optional-only data-collection consent с host permission, поэтому это намеренно два отдельных пользовательских действия. Для AI также отдельно разрешается точный endpoint. Перед отправкой нажмите «Сформировать точный payload»: popup покажет фактическое JSON-тело, UTF-8 размер и эвристические предупреждения. Отправка разрешается только для неизменившегося SHA-256 preview и требует отдельного подтверждения; эти эвристики не являются DLP.

## Граф процессов

Popup сначала получает данные и сохраняет versioned snapshot в `storage.session`, затем открывает отдельную вкладку графа. После закрытия исходной SIEM-вкладки поиск, фильтры, pan/zoom, tooltip и переходы по уже известным UUID продолжают работать. «Обновить данные» требует доступную вкладку того же исходного SIEM; при её отсутствии текущий snapshot не стирается.

## Development-установка

```bash
npm ci
npm run build:firefox
```

Откройте `about:debugging` → **This Firefox** → **Load Temporary Add-on** и выберите `dist/firefox/manifest.json`.
