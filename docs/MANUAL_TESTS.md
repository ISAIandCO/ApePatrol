# Manual regression matrix

Record Firefox, MP SIEM build, role, result and evidence for every row before release.

## Installation and update

- [ ] Clean Firefox 140+ installs the signed XPI without Developer Mode.
- [ ] Before configuration, ordinary websites show no SiemMonkey script, DOM marker or XHR/fetch patch.
- [ ] Adding one SIEM origin grants only `<origin>/*`; removing it unregisters scripts and removes permission.
- [ ] Release N discovers N+1 via `updates.json`; SHA-256 matches and settings/instances survive.

## Event page

- [ ] Open ordinary and correlation events; close/reopen the card.
- [ ] Switch quickly between events and navigate through the SPA.
- [ ] Confirm observer/API call counts remain bounded.
- [ ] Copy/download Pretty JSON and open/copy share link.
- [ ] Native correlation description and native field action are not duplicated.
- [ ] Missing fields do not break the popup.

## Process

- [ ] Sysmon Event ID 1 tree and timeline.
- [ ] Windows 4688 with GUID and PID/name fallback.
- [ ] Linux `execve`.
- [ ] Empty result, parents, descendants, duplicate, cycle and PID reuse.
- [ ] Search, source highlight, copy PID/GUID/cmdline and node limit.

## Related and incidents

- [ ] Host/account/IP/process searches open correctly for ±5m/15m/1h/24h.
- [ ] Linked `incident_id` displays; absent incident degrades clearly.
- [ ] No incident mutation is offered.

## IOC and Table Lists

- [ ] `IOCs_Value` is resolved through API and description is appended once.
- [ ] Cancel, missing list and changed request payload leave native add intact.
- [ ] Read lists, preview add/remove and confirm exact row.
- [ ] Observer/read-only role receives a clear 403 and no success state.

## Assets/EDR

- [ ] EDR present, absent and asset missing.
- [ ] Hiding EDR UI does not suppress or stall `/api/edr/assets` requests.

## Security and privacy

- [ ] No API keys in page globals, DOM, console or `storage.sync`.
- [ ] `javascript:`, `data:`, `file:` and custom URL schemes are rejected.
- [ ] Event value and custom filter containing HTML remain inert text.
- [ ] LLM response `<img src=x onerror=alert(1)>` remains inert text.
- [ ] AI dialog shows endpoint/mode/fields and requires confirmation each time.
- [ ] 401/403/404, invalid JSON, timeout and network failure show distinct safe errors.
