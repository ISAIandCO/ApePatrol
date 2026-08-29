# Security policy

## Threat model

SIEM page JavaScript, event fields, настройки, provider responses и LLM output считаются недоверенными. Content bundle работает в `ISOLATED` world; page world не получает settings, API keys, bearer tokens или SIEM credentials.

## Границы

- нет постоянных host permissions и static content scripts;
- ISOLATED world содержит DOM/API orchestration;
- нет MAIN-world scripts, `window.postMessage` channel и патчей `window.fetch`/`XMLHttpRequest.prototype`;
- IOC description и Table List mutations используют отдельные runtime actions; background проверяет configured origin, feature, method/path, token, row, размер тела и redirect;
- разрешены только `http:`/`https:` URL без embedded credentials;
- PDQL строится централизованным builder с escaping;
- secrets находятся в `storage.local`, внешний fetch выполняет background page;
- debug log имеет level/module/operation и редактирует secret-like keys, request body и full event payload;
- AI отправка повторно строит payload и сравнивает SHA-256 с показанным preview; full/redaction режимы не объявляются DLP.
- Batch IOC запускается только после табличного preview/confirmation, ограничен 200 jobs и 4 concurrent requests, обрабатывает каждый provider независимо и не сохраняет API keys в cache;
- Workspace messages принимаются только от extension pages или настроенного SIEM origin; snapshots очищаются от secret-like keys и имеют жёсткие лимиты item/workspace;
- settings profiles не содержат secrets, проходят schema validation/normalization; managed locks повторно применяет background, а не только UI;
- Rule Intelligence не выводит ATT&CK mapping, если он отсутствует в явных SIEM metadata.

## Disclosure

Не публикуйте сведения об уязвимости в issue. Используйте GitHub Security Advisory репозитория или приватный канал владельца. Укажите версию, Firefox/MP SIEM build, шаги и минимальный PoC без реальных SOC-данных.

## Dependencies

Production artifact не содержит прежние jQuery 3.5.1, jQuery UI 1.12.1, Moment, Underscore или D3 v4. CI использует lockfile, `npm audit`, фиксированный Node и Actions по commit SHA.
