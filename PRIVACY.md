# Privacy

ApePatrol не имеет телеметрии и не отправляет данные оператору расширения.

## Локально

На явно разрешённом origin расширение читает DOM карточки события и поля, необходимые для выбранной функции. Настройки UI, instances и provider templates находятся в `storage.sync`; VirusTotal/LLM API keys — только в `storage.local`.

## MaxPatrol

Расширение использует текущую SIEM-сессию для чтения metadata, событий, приложений, пользователя, Table Lists, фильтров и assets. Table List изменяется только после preview и подтверждения.

## External

- VirusTotal: выбранный hash и API key;
- custom enrichment: браузер открывает сформированный HTTP(S) URL, скрытого API-запроса нет;
- LLM endpoint: только подтверждённый selected/redacted/full event и API key.

Передача отключена, пока пользователь отдельно не настроит provider, не выдаст Firefox permission и не запустит действие. Автоматических повторов нет.
