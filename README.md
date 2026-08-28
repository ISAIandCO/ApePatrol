# ApePatrol

**Firefox investigation companion for MaxPatrol SIEM**

> ApePatrol is the successor to SiemMonkey. The project has been substantially redesigned around Firefox, with MaxPatrol SIEM 27.3 as its primary target.

ApePatrol — расширение-компаньон для расследований в **MaxPatrol SIEM**. Версия 27.3 является основной целью разработки и проверки; на других версиях адаптер пытается работать через capability/DOM detection и best-effort fallback без жёсткой блокировки по номеру версии. Название продолжает исходную идею проекта: Monkey эволюционировал в Ape, а **APE** может читаться как *Analyst Productivity Extension*.

ApePatrol — независимый open-source проект. Он не связан с Positive Technologies, не одобрен компанией и не является официальным компонентом MaxPatrol SIEM.

## Возможности ApePatrol 3.0.5

- извлечение контекста открытого события;
- copy/download JSON и shareable event link;
- ограниченный process graph и timeline для Sysmon 1, Windows 4688 и Linux `execve`;
- Related events для host, account, IP, process GUID, hash и executable;
- field actions только при отсутствии штатного action menu;
- отображение связанного `incident_id` без угадывания mutating API;
- Table Lists read/add/remove с preview и явным подтверждением;
- безопасные HTTP(S) enrichment-ссылки, VirusTotal и OpenAI-compatible endpoint;
- опциональное описание IOC через узкий одноразовый MAIN-world bridge;
- скрытие EDR UI без блокирования XHR/fetch.

## Разрешения

После установки расширение не имеет доступа к сайтам и нигде не выполняет content script. Пользователь добавляет точный origin, например `https://siem.example.internal`, после чего Firefox запрашивает доступ только к `https://siem.example.internal/*`. Регистрация снимается при удалении origin или permission.

Минимальная версия — Firefox Desktop 140. Для Android установлен отдельный baseline 142, соответствующий появлению встроенного согласия на передачу данных.

## Приватность и безопасность

Секреты хранятся только в `storage.local`, никогда не выдаются content script/page world и не пишутся в DOM или журнал. MAIN world получает лишь одноразовые данные конкретной IOC-операции. Event values, LLM output и настройки считаются недоверенными и выводятся через `textContent`/DOM API. Внешняя передача отключена до отдельной настройки, выдачи permission и действия оператора.

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
