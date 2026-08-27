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

VirusTotal и AI включаются отдельно. Firefox показывает permissions для точного endpoint и типов передаваемых данных. Перед каждой AI-отправкой popup показывает endpoint, режим и видимые поля; затем требует подтверждение.

## Development-установка

```bash
npm ci
npm run build:firefox
```

Откройте `about:debugging` → **This Firefox** → **Load Temporary Add-on** и выберите `dist/firefox/manifest.json`.
