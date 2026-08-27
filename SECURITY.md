# Security policy

## Threat model

SIEM page JavaScript, event fields, настройки, provider responses и LLM output считаются недоверенными. MAIN world не получает полный settings object, API keys, bearer tokens или SIEM credentials.

## Границы

- нет постоянных host permissions и static content scripts;
- ISOLATED world содержит DOM/API orchestration;
- MAIN bridge регистрируется только на разрешённом origin и лишь для IOC description;
- bridge проверяет endpoint, payload, длины и TTL, хранит одноразовое state и умеет unpatch;
- разрешены только `http:`/`https:` URL без embedded credentials;
- PDQL строится централизованным builder с escaping;
- secrets находятся в `storage.local`, внешний fetch выполняет background page;
- debug log редактирует secret-like keys и не содержит full event JSON.

## Disclosure

Не публикуйте сведения об уязвимости в issue. Используйте GitHub Security Advisory репозитория или приватный канал владельца. Укажите версию, Firefox/MP SIEM build, шаги и минимальный PoC без реальных SOC-данных.

## Dependencies

Production artifact не содержит прежние jQuery 3.5.1, jQuery UI 1.12.1, Moment, Underscore или D3 v4. CI использует lockfile, `npm audit`, фиксированный Node и Actions по commit SHA.
