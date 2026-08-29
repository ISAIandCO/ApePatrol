# ApePatrol

**Firefox investigation companion for MaxPatrol SIEM**

> ApePatrol is the successor to SiemMonkey. The project has been substantially redesigned around Firefox, with MaxPatrol SIEM 27.3 as its primary target.

ApePatrol — расширение-компаньон для расследований в **MaxPatrol SIEM**. Версия 27.3 является основной целью разработки и проверки; на других версиях адаптер пытается работать через capability/DOM detection и best-effort fallback без жёсткой блокировки по номеру версии. Название продолжает исходную идею проекта: Monkey эволюционировал в Ape, а **APE** может читаться как *Analyst Productivity Extension*.

ApePatrol — независимый open-source проект. Он не связан с Positive Technologies, не одобрен компанией и не является официальным компонентом MaxPatrol SIEM.

## Возможности ApePatrol 3.1.0

- извлечение контекста открытого события;
- copy/download JSON и shareable event link;
- интерактивный force-directed граф процессов с parent/child-связями и хронологической раскладкой для Sysmon 1, Windows 4688 и Linux `execve`: отдельная вкладка, размер по числу связей, выделение исходного процесса, подробности по наведению и открытие события по клику;
- Related events для host, account, IP, process GUID, hash и executable;
- field actions только при отсутствии штатного action menu;
- отображение связанного `incident_id` без угадывания mutating API;
- Table Lists read/add/remove с preview и явным подтверждением;
- 48 встроенных русскоязычных PDQL-фильтров с описаниями и проверкой доступных полей;
- IOC-проверки из иконки у конкретного поля: VirusTotal, AbuseIPDB, Kaspersky OpenTIP и ThreatFox API, а также безопасные ссылки на Shodan, GreyNoise, MalwareBazaar, URLhaus и другие отчёты;
- опциональное описание IOC через узкий одноразовый MAIN-world bridge;
- скрытие EDR UI без блокирования XHR/fetch.

## Разрешения

После установки расширение не имеет доступа к сайтам и нигде не выполняет content script. Пользователь добавляет точный origin, например `https://siem.example.internal`, после чего Firefox запрашивает доступ только к `https://siem.example.internal/*`. Регистрация снимается при удалении origin или permission.

Минимальная версия — Firefox Desktop 140. Для Android установлен отдельный baseline 142, соответствующий появлению встроенного согласия на передачу данных.

## Приватность и безопасность

Секреты хранятся только в `storage.local`, никогда не выдаются content script/page world и не пишутся в DOM или журнал. MAIN world получает лишь одноразовые данные конкретной IOC-операции. Event values, enrichment/LLM output и настройки считаются недоверенными и выводятся через `textContent`/DOM API. Внешняя передача отключена до отдельной настройки, отдельного разрешения Firefox на передачу данных, разрешения для точного API endpoint и клика оператора по провайдеру.

Подробнее: [INSTALL.md](INSTALL.md), [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [бренд](docs/BRANDING.md), [ручные тесты](docs/MANUAL_TESTS.md).

## Разработка

Требуется Node.js 22.

```bash
npm ci
npm run build:firefox
```

Artifact находится в `dist/firefox`. Основные команды:

```bash
npm run lint
npm test
npm run package:firefox
npm run build:self-hosted
npm run check:reproducible
```

Проект распространяется по Apache License 2.0. Исходные `LICENSE` и `NOTICE` сохранены.
