# ApePatrol 3.3 implementation report

Platform-hardening 3.2 was merged as PR #3 at `06bff61e9b95156d38b3108991f61550d89f4c4e`. Version 3.3 implements the analyst-workflow scope from `apepatrol_codex_implementation_spec.md` on top of that merge.

## Implemented P0

- Popup connection and optional-feature initialization are separate. `relatedEvents=false`, an unavailable rule context or a provider failure no longer turns the whole popup into “Not connected”.
- `incidentContext`, `processTree`, `relatedEvents`, `tableListTools` and `aiAssistant` change the visible/queried UI; disabled EDR no longer triggers EDR asset enrichment.
- The MAIN-world `fetch`/XHR interceptor and `window.postMessage` channel were removed from source, build and registration. Upgrade cleanup unregisters legacy `apepatrol-bridge-*` registrations.
- IOC-description and normal Table List writes use specialized runtime actions. Background rechecks configured origin, enabled feature, confirmation, operation, discovered table token, scalar row, UTF-8 body limit, exact method/path and redirect boundary.
- Security regressions cover forged tokens, generic write-route denial, malformed/oversized bodies, cross-origin redirect, double submit and false-success prevention.

## Implemented P1 platform stability

- `storage.onChanged` applies settings to an already-open SIEM tab. Only DOM-feature inputs rebuild injected components; process/search options are read live and relevant API caches are cleared.
- The R27.3 adapter caches known roots and a field index. Mutation records incrementally discover added ShadowRoots/frames; 500 changes coalesce into one extraction window. ApePatrol's own UI mutations are ignored.
- Process parent resolution uses host-scoped GUID/PID indexes and binary latest-prior lookup. PID fallback has a 24-hour parent window and never links a process that starts after the child. Depth calculation is linear.
- The graph stores a versioned `storage.session` snapshot (ten newest, up to 10 000 nodes), survives source-tab closure, reports stale state and keeps local interactions available.
- Renderer hit testing uses a spatial grid, force simulation has an explicit iteration cap, labels remain simplified for large views, and pan/zoom does not restart layout.
- Local no-request filters cover process name/path, account, PID, host, event type, time, ancestors, descendants, direct relations and isolated nodes.
- AI has exact final-body preview, UTF-8 byte count, selected/allowlist/redacted/full modes, local PII/secret warnings, deterministic truncation and SHA-256 stale-preview protection. Warnings are explicitly not DLP.
- Stable error codes and structured redacting logger primitives were added.
- The old non-functional `maxConcurrentRequests` setting remains removed. Progressive range expansion now has a separate functional `queryConcurrency` limit.

## Implemented P1 analyst workflows

- Progressive process expansion starts with a bounded seed window and uses offset pagination. Parents, children, siblings and adjacent time ranges reuse/deduplicate loaded events, support AbortController cancellation and preserve partial results at the node limit. An explicit action raises the cap up to 10 000.
- The graph page exposes partial/limit state, range step, dual time sliders and same-origin source-tab reconnection. Expanded responses update the existing session snapshot.
- Batch IOC enrichment previews each IOC/provider pair and requires confirmation. A bounded worker pool, Retry-After/backoff, HTTP 429 normalization, cancel, per-pair retry, partial results and per-provider TTL cache are implemented. Cache entries never contain API keys.
- Investigation Workspace persists bounded, sanitized workspaces in extension IndexedDB. Popup/field/graph actions pin events, hosts, accounts, incidents, IOC and processes; the workspace page supports CRUD, notes, tags, search, sort, snapshots and JSON/Markdown export.

## Implemented P2

- Event Compare compares two or three workspace events, normalizes field names, groups process/network/account/host/rule/raw fields and copies JSON/Markdown diff.
- Rule Intelligence renders rule ID/name/description/category/severity/references/KB. ATT&CK techniques appear only from explicit SIEM metadata.
- Enterprise Profiles export/import schema-versioned non-secret settings with merge/replace validation. Firefox `storage.managed` supplies defaults and locked paths; background tracks permitted user override paths, preserves underlying user values, and reapplies policy during load/save and live updates.

## Performance evidence

Synthetic GUID-chain benchmark from the implementation environment:

| Nodes | Edges | Build time | Heap delta | Parent index lookups |
|---:|---:|---:|---:|---:|
| 1 000 | 999 | 11.53 ms | 1.21 MiB | 999 |
| 5 000 | 4 999 | 37.21 ms | 8.39 MiB | 4 999 |
| 10 000 | 9 999 | 63.93 ms | 8.89 MiB | 9 999 |

Wall-clock values are informational; CI asserts graph integrity and bounded lookup growth rather than a fragile shared-runner timing threshold.

## Validation

- `npm ci`
- ESLint
- Vitest: 38 files / 168 tests (unit, DOM fixture, security and integration-oriented tests)
- raw/self-hosted Firefox builds
- policy scan (including forbidden MAIN-world instrumentation)
- `web-ext lint`
- reproducibility check
- graph benchmark
- production dependency audit
- package/lock/manifest/commit release consistency

Live MaxPatrol SIEM checks remain mandatory for actual 27.3 DOM variants, roles, authentication cookies, provider keys, Table List column ordering and source-tab lifecycle. See `docs/MANUAL_TESTS.md`.

## Remaining release gate

The product scope above is implemented. A realistic permission-granted Firefox/MP SIEM browser fixture is still unavailable in CI, so the expanded live matrix in `docs/MANUAL_TESTS.md` remains mandatory before release. This implementation does not create or merge its product PR automatically.
