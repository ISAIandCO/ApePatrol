# Manual regression matrix

Record Firefox, MP SIEM build, role, result and evidence for every row before release.

## Installation and update

- [ ] Clean Firefox 140+ installs the signed XPI without Developer Mode.
- [ ] Before configuration, ordinary websites show no ApePatrol script, DOM marker or XHR/fetch patch.
- [ ] Adding one SIEM origin grants only `<origin>/*`; removing it unregisters scripts and removes permission.
- [ ] Release N discovers N+1 via `updates.json`; SHA-256 matches and settings/instances survive.

## Event page

- [ ] R27.3 nested `ips-shell-remote-app` / `siem-core` shadow roots expose `mc-sidebar` fields.
- [ ] R27.2/R27.1 or available legacy deployment exposes title/value fields through its sidebar or same-origin iframe fallback.
- [ ] Open ordinary and correlation events; close/reopen the card.
- [ ] Switch quickly between events and navigate through the SPA.
- [ ] Confirm observer/API call counts remain bounded.
- [ ] Toggle each feature and change providers/aliases/filters/debug state in options; the already-open SIEM tab updates without reload and unrelated features remain working.
- [ ] Copy/download Pretty JSON and open/copy share link.
- [ ] Native correlation description and native field action are not duplicated.
- [ ] Missing fields do not break the popup.

## Process

- [ ] Sysmon Event ID 1 в свободном force-directed графе и хронологической раскладке.
- [ ] Windows 4688 with GUID and PID/name fallback.
- [ ] Linux `execve`.
- [ ] Empty result, parents, descendants, duplicate, cycle and PID reuse.
- [ ] Граф открывается в отдельной вкладке и сохраняется после закрытия popup.
- [ ] Закрытие исходной SIEM-вкладки до/после открытия graph-tab не уничтожает сохранённый snapshot; stale indicator появляется, локальные действия продолжают работать.
- [ ] Размер узла растёт с числом связей; исходный процесс выделен цветом по UUID, GUID или ближайшему PID.
- [ ] Наведение показывает поля процесса; клик открывает событие запуска по UUID в новой вкладке SIEM.
- [ ] Поиск подсвечивает совпадения; масштабирование, панорамирование, перетаскивание узлов, «Вписать», обновление и лимит узлов.
- [ ] Свободная и хронологическая раскладки показывают одинаковые направленные parent/child-рёбра.
- [ ] Локальные фильтры process/path/account/PID/host/event/time, ancestors/descendants/direct и hide isolated не выполняют новый SIEM-запрос.
- [ ] На снимках 5k–10k pointermove не вызывает линейный hit scan и force layout останавливается после стабилизации.

## Related and incidents

- [ ] Host/account/IP/process searches open correctly for ±5m/15m/1h/24h.
- [ ] Linked `incident_id` displays; absent incident degrades clearly.
- [ ] No incident mutation is offered.

## IOC and Table Lists

- [ ] `IOCs_Value` повторно разрешается через API; отдельная кнопка добавляет ровно одну строку с описанием, а native submit не перехватывается.
- [ ] Cancel, missing list, forged token, double click и changed row не дают ложного success state.
- [ ] Read lists, preview add/remove and confirm exact row.
- [ ] Observer/read-only role receives a clear 403 and no success state.
- [ ] Иконка у каждого IOC-поля предлагает только подходящие типу API и ссылки; результат остаётся в меню этого поля.
- [ ] VirusTotal, AbuseIPDB, OpenTIP и ThreatFox работают после трёх независимых шагов: сохранение ключа, data consent и endpoint permission.
- [ ] Private/reserved IP не передаётся ни одному API.

## Assets/EDR

- [ ] EDR present, absent and asset missing.
- [ ] Hiding EDR UI does not suppress or stall `/api/edr/assets` requests.

## Security and privacy

- [ ] No API keys in page globals, DOM, console or `storage.sync`.
- [ ] `javascript:`, `data:`, `file:` and custom URL schemes are rejected.
- [ ] Event value and custom filter containing HTML remain inert text.
- [ ] LLM response `<img src=x onerror=alert(1)>` remains inert text.
- [ ] AI preview показывает точное финальное JSON-тело, реальный UTF-8 byte count и endpoint; Authorization/API key в preview отсутствует.
- [ ] Selected fields, strict allowlist, redacted и full дают ожидаемые разные payload; full показывает отдельное предупреждение.
- [ ] Изменение события/выбранных полей после preview приводит к stale-preview отказу, пока preview не создан заново.
- [ ] 401/403/404, invalid JSON, timeout and network failure show distinct safe errors.
