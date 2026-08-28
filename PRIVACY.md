# Privacy

ApePatrol не имеет телеметрии и не отправляет данные оператору расширения.

## Локально

На явно разрешённом origin расширение читает DOM карточки события и поля, необходимые для выбранной функции. Настройки UI, instances и provider templates находятся в `storage.sync`; ключи VirusTotal, AbuseIPDB, Kaspersky OpenTIP, ThreatFox и LLM — только в `storage.local`.

## MaxPatrol

Расширение использует текущую SIEM-сессию для чтения metadata, событий, приложений, пользователя, Table Lists, фильтров и assets. Table List изменяется только после preview и подтверждения.

## External

- VirusTotal: выбранный hash, IP, domain или URL и API key;
- AbuseIPDB: выбранный публичный IP и API key;
- Kaspersky OpenTIP: выбранный hash, публичный IP, domain или URL и API token;
- ThreatFox: выбранный hash, публичный IP, domain или URL и Auth-Key;
- custom enrichment: браузер открывает сформированный HTTP(S) URL, скрытого API-запроса нет;
- LLM endpoint: только подтверждённый selected/redacted/full event и API key.

Private, loopback, link-local, multicast и reserved IP никогда не отправляются внешним API. Передача отключена, пока пользователь отдельно не сохранит ключ, не выдаст Firefox data-collection permission, не разрешит точный API endpoint и не нажмёт провайдера в меню иконки выбранного поля. Автоматических запросов и повторов нет.
