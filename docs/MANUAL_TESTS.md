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

- [ ] Первое открытие использует небольшой seed range и paged offsets, а не безусловный host-wide ±24h запрос.
- [ ] Expand parents/children/both/siblings и previous/next interval добавляют новые узлы без дублей и повторного удаления уже загруженных.
- [ ] Cancel останавливает активный запрос; partial graph и прежний snapshot остаются доступны.
- [ ] Достижение `maxNodes` показывает limit indicator без error; явное «Разрешить ещё узлы» повышает cap, но не выше 10 000.
- [ ] Time sliders меняют только локально видимый диапазон и не выполняют SIEM request.
- [ ] После закрытия source tab «Подключить SIEM-вкладку» находит другую вкладку того же exact origin и разрешает продолжить expansion.
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
- [ ] Batch preview перечисляет каждую пару IOC/type/provider; без отдельного confirmation запросов нет.
- [ ] Concurrency не превышает настройку; HTTP 429 соблюдает bounded Retry-After/backoff, cancel останавливает batch.
- [ ] Ошибка/нет permission у одного provider не уничтожает успешные результаты других; retry запускает только выбранную failed pair.
- [ ] Повторный batch в пределах TTL показывает cache result без внешнего запроса; после TTL выполняет новый запрос. API keys отсутствуют в cache.

## Investigation Workspace / Compare

- [ ] Создать, переименовать и удалить workspace; notes/tags/search/sort сохраняются после перезапуска Firefox.
- [ ] Прикрепить current event/host/account/incident из popup, IOC из field menu и process правым кликом из графа.
- [ ] Закрыть SIEM и убедиться, что локальные snapshots остаются видимыми; event link корректно деградирует при отсутствии UUID/origin.
- [ ] JSON/Markdown export пригоден для тикета и не содержит extension API keys/secrets.
- [ ] Выбрать 2 и 3 event items: same/changed/only поля сгруппированы в process/network/account/host/rule/raw; copy JSON/Markdown работает.

## Rule Intelligence

- [ ] Correlation event показывает rule name/id/description/category/severity/KB/references.
- [ ] MITRE ATT&CK отображается только при явном mapping в rule/event metadata; process name не создаёт guessed technique.

## Enterprise Profiles

- [ ] Export/import replace и merge проходят schema validation и не включают API keys.
- [ ] Wrong kind/schema и malformed JSON не изменяют текущие settings.
- [ ] Firefox `storage.managed` defaults применяются; locked feature/instances/providers нельзя изменить ни через UI, ни через runtime save.
- [ ] User overrides продолжают работать для путей вне `lockedPaths`; managed policy live update применяется к открытой SIEM-вкладке.

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
- [ ] Закрытие и повторное открытие popup в той же SIEM-вкладке сохраняет AI-диалог, черновик и выбранный раздел; переход на другое событие не сбрасывает диалог.
- [ ] «Добавить текущее событие» прикладывает новое событие к следующему сообщению без дубликатов; закрытие SIEM-вкладки удаляет её session-диалог.
- [ ] AI tool call только показывает read-only запрос; до подтверждения сетевой запрос к SIEM не выполняется, а результат не отправляется LLM до нового preview и подтверждения.
- [ ] «Перенести диалог» открывает выбранный Investigation Workspace; повторный перенос не дублирует сообщения.
- [ ] AI-диалог Workspace сохраняется после закрытия вкладки расширения, умеет прикладывать отмеченные объекты/заметки и удаляется вместе с Workspace.
- [ ] Изменение события/выбранных полей после preview приводит к stale-preview отказу, пока preview не создан заново.
- [ ] 401/403/404, invalid JSON, timeout and network failure show distinct safe errors.
