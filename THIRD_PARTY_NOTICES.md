# Third-party notices

Production WebExtension состоит из кода проекта и изображений, покрытых существующими `LICENSE`/`NOTICE`; прежние vendored JavaScript libraries удалены из artifact.

Инструменты сборки и тестирования (`esbuild`, ESLint, Vitest, jsdom, web-ext и transitive dependencies) используются только при разработке/CI. Точные версии и лицензии зафиксированы в `package-lock.json`; release workflow публикует CycloneDX SBOM.

На дату 2026-08-27 полный `npm audit` сообщает high-severity DoS advisory в `image-size@2.0.2`, transitive dependency `addons-linter`/`web-ext`. Пакет не попадает в extension artifact и обрабатывает только доверенный source tree в CI; исправленной upstream-версии ещё нет. Обязательная production-проверка `npm audit --omit=dev --audit-level=high` проходит без уязвимостей.
