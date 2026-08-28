# MaxPatrol SIEM 27.3 compatibility

The adapter is intentionally R27.3-first, not R27.3-only. It uses capability detection, open shadow-root traversal, same-origin iframe traversal and safe fallback selectors rather than a version gate. Older R24–R27.2 interfaces are supported on a best-effort basis and remain in the regression matrix, while 27.3 is the primary release target.

## Endpoint inventory

| Method | Path | Feature | Access | Fallback |
|---|---|---|---|---|
| GET | `/api/events/v2/events_metadata` | taxonomy/capability | read | feature hidden |
| POST | `/api/events/v2/events?limit=&offset=` | event/process search | read | error UI |
| POST | `/api/events/v2/events/count_distinct_field_values` | grouped investigation | read | feature hidden |
| GET | `/api/tenants/v2/menu` | registered apps/KB/EDR hints | read | no app link |
| GET | `/api/events/v2/table_lists` | Table Lists/IOC mapping | read | tools disabled |
| GET | `/api/account/userinfo` | current user/IOC description | read | IOC feature disabled |
| GET | `/api/siem/v2/rules/correlation/{name}` | correlation metadata | read | native UI only |
| GET | `/api/v2/events/filters_hierarchy` | filter capability | read | local query links |
| GET | `/api/v3/events/filters/{id}` | saved filter | read | unavailable |
| POST | `/api/v3/events/filters` | saved filter creation adapter | write | no server temp filter |
| DELETE | `/api/v3/events/filters/{id}` | saved filter deletion adapter | write | unavailable |
| POST | `/api/assets_temporal_readmodel/v1/assets_grid` | assets | read | event fields only |
| POST | `/api/whitelists/{token}/insert` | Table List add / IOC | write | native workflow preserved |
| POST | `/api/whitelists/{token}/remove` | Table List remove | write | unavailable |

All calls check HTTP status. 401/403 are not retried. 404 becomes `unsupported`; timeouts, invalid JSON and network errors are distinct. Cached metadata is cleared when a content context is destroyed or origin registration changes.

## Native overlap

- native correlation description: ApePatrol does not add a second description;
- native PDQL/event action menu: ApePatrol skips that field;
- native autocomplete: the adapter detects it; 3.0 does not overlay a second autocomplete;
- EDR integration: optional disable works by hiding detected UI, not suppressing requests.

## Verification status

DOM adapter behaviour is covered by sanitised fixtures. API payloads and security boundaries are unit/build tested. A real MP SIEM 27.3 deployment is intentionally not emulated in CI; every row in `MANUAL_TESTS.md` must be completed before the first signed release. Mutating incident actions are not implemented until a real 27.3 API/semantics check is recorded.
