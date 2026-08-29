# ApePatrol 3.2 implementation report

Baseline: `main` commit `2c5f45bbc9d91ab0506568d5a90cac5bd9ccb21e`. Latest published release during the audit: `v3.1.0`; no open issues were present. This report covers the platform-hardening scope selected from `apepatrol_codex_implementation_spec.md`.

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
- The unused `maxConcurrentRequests` setting was removed because the current process workflow performs one bounded query; keeping a non-functional control was misleading.

## Performance evidence

Synthetic GUID-chain benchmark from the implementation environment:

| Nodes | Edges | Build time | Heap delta | Parent index lookups |
|---:|---:|---:|---:|---:|
| 1 000 | 999 | 13.73 ms | 1.17 MiB | 999 |
| 5 000 | 4 999 | 34.79 ms | 8.47 MiB | 4 999 |
| 10 000 | 9 999 | 64.17 ms | 9.01 MiB | 9 999 |

Wall-clock values are informational; CI asserts graph integrity and bounded lookup growth rather than a fragile shared-runner timing threshold.

## Validation

- `npm ci`
- ESLint
- Vitest (unit, DOM fixture, security and integration-oriented tests)
- raw/self-hosted Firefox builds
- policy scan (including forbidden MAIN-world instrumentation)
- `web-ext lint`
- reproducibility check
- graph benchmark
- production dependency audit
- package/lock/manifest/commit release consistency

Live MaxPatrol SIEM checks remain mandatory for actual 27.3 DOM variants, roles, authentication cookies, provider keys, Table List column ordering and source-tab lifecycle. See `docs/MANUAL_TESTS.md`.

## Deliberately deferred

The following are useful, but not appropriate to mix into the security/platform PR before live validation:

- targeted progressive ancestors/children pagination and time slider;
- batch IOC cache/rate-limit UX;
- Investigation Workspace and export;
- Event Compare;
- expanded Rule Intelligence;
- Enterprise managed profiles;
- automated Firefox smoke against a realistic permission-granted MP SIEM fixture.

These should be separate product PRs after the P0/P1 platform changes are manually validated. No release is created or merged by this implementation.
