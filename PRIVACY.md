# Privacy

ApePatrol не имеет телеметрии и не отправляет данные оператору расширения.

## Локально

На явно разрешённом origin расширение читает DOM карточки события и поля, необходимые для выбранной функции. Настройки UI, instances и provider templates находятся в `storage.local`; ключи VirusTotal, AbuseIPDB, Kaspersky OpenTIP, ThreatFox и LLM — также только в `storage.local`, но под отдельным ключом. Временные versioned snapshots графов находятся в локальной IndexedDB (до десяти последних, максимум 10 000 узлов каждый) и не синхронизируются.

Investigation Workspace хранится локально в IndexedDB расширения: до 500 объектов в workspace, максимум 1 MiB на item snapshot и 20 MiB на workspace. Secret-like ключи удаляются из snapshots до сохранения. Batch IOC cache находится в `storage.local`, ограничен 500 актуальными ответами и содержит provider/IOC/status/result/timestamps, но не API keys.

SEC AI chat живой SIEM-вкладки хранится в локальной IndexedDB по `tabId`, ограничен 2 MiB и удаляется при закрытии вкладки или следующем запуске Firefox. Постоянный чат Investigation Workspace хранится в отдельном store локальной IndexedDB и удаляется вместе с расследованием; в JSON/Markdown export он не входит. Сообщения и очищенные attachments остаются локальными, пока оператор не просмотрит точный payload и не подтвердит внешнюю отправку.

Enterprise profile export строится только из non-secret settings. Firefox `storage.managed` может задать defaults/locks; policy не предоставляет механизм экспорта или распространения API keys.

## MaxPatrol

Расширение использует текущую SIEM-сессию для чтения metadata, событий, приложений, пользователя, Table Lists, фильтров и assets. Table List изменяется только после preview и подтверждения через специализированный background action. Page-world перехват `fetch`/XHR не используется.

## External

- VirusTotal: выбранный hash, IP, domain или URL и API key;
- AbuseIPDB: выбранный публичный IP и API key;
- Kaspersky OpenTIP: выбранный hash, публичный IP, domain или URL и API token;
- ThreatFox: выбранный hash, публичный IP, domain или URL и Auth-Key;
- custom enrichment: браузер открывает сформированный HTTP(S) URL, скрытого API-запроса нет;
- LLM endpoint: только точное подтверждённое тело с историей выбранного диалога и явно приложенным контекстом в режиме selected fields, strict allowlist, redacted или full, плюс API key. Preview показывает тело без Authorization header; API key подставляет background только при отправке.
- Read-only AI tools не выполняются автоматически: запрос AI проверяется по фиксированному allowlist, показывается оператору и выполняется только после отдельного подтверждения. Результат остаётся локальным до следующего preview и подтверждения внешней отправки.

Private, loopback, link-local, multicast и reserved IP никогда не отправляются внешним API. Передача отключена, пока пользователь отдельно не сохранит ключ, не выдаст Firefox data-collection permission, не разрешит точный API endpoint и явно не подтвердит одиночный или batch-запрос. После batch-confirm допускаются только ограниченные повторы временных ошибок/HTTP 429 с backoff; cache hit не выполняет внешний запрос.
