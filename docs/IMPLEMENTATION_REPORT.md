# ApePatrol 3.0 implementation report

This release completes the SiemMonkey → ApePatrol transition. ApePatrol is the Firefox-first successor focused on analyst investigation workflows in MaxPatrol SIEM.

## Architecture and Firefox

Chrome service worker and static all-site injection were replaced by a Firefox background event page and `browser.scripting.registerContentScripts()`. Exact-origin permissions drive one ISOLATED bundle and, only when necessary, a narrow MAIN bridge. Code is bundled from ES modules but runs in Firefox-compatible IIFEs.

Firefox Desktop 140+ is the baseline because `data_collection_permissions` is required by the privacy model and became available in 140. Android uses 142+. No `strict_max_version` is set.

## Existing functionality

| Function | Before | 3.0 | Verified on live 27.3 |
|---|---|---|---|
| Event context/export/link | global DOM scraping | R27.3 adapter, safe filename/URL | Pending manual matrix |
| Process tree | recursive N+1, globals, fixed SVG | minimal fields, one query, limits, cycle/PID reuse protection, tree/timeline | Pending |
| IP/hash links | unsafe templates/window.open | typed providers, encoded values, HTTP(S) only | Unit tested; live pending |
| VirusTotal | popup key from sync storage | background fetch, local key, explicit permissions | Unit/build tested; live pending |
| Custom filters | raw interpolation/server temp filter | central PDQL builder; no temp-filter workflow | Unit tested; live pending |
| Correlation description | duplicate legacy UI | native detection; no duplicate | Fixture tested; live pending |
| Table Lists | contextless delete icon | list, preview, confirmation, typed errors | Pending |
| IOC description | DOM attributes/global XHR patch | API mapping, one-use state, XHR/fetch endpoint guard | Build tested; live pending |
| EDR disable | request left pending | UI-level hide | Pending |
| AI | automatic unsafe HTML path | disabled by default, modes/redaction, per-send confirm, text-only rendering | Security tested; live pending |

## Security fixes

Removed all-site execution, global settings exposure, secrets in sync storage, raw HTML sinks, unsafe schemes, unescaped PDQL, Zone.js reliance, uncontrolled interception, synchronous resource XHR, implicit globals and vulnerable vendored jQuery UI 1.12.1. Empty settings, VT migration, hash extraction, null values, 401/403, empty graphs and cycles have explicit handling/tests.

## CI and release

CI pins Actions by SHA, uses Node 22 and lockfile, runs audit/lint/tests/build/web-ext lint/reproducibility, and uploads an unsigned review ZIP. Release jobs separate read-only build/sign from write-enabled publication, request Mozilla unlisted signing, verify the signed manifest, produce source ZIP/CycloneDX SBOM/updates.json/SHA256SUMS, and publish only after all checks pass.

## Remaining limitations

- No real MP SIEM instance is available in CI; live verification remains mandatory.
- Incident mutations are intentionally absent until documented 27.3 semantics and roles are confirmed.
- Process graph obtains one bounded ±24h host sample; deployments with very large activity may need a narrower scope or higher manual limit.
- Sidebar is deferred; popup and feature logic are separated so a later sidebar can reuse them.
- Legacy R24–R27.2 paths were removed from production and are available only through Git history.
- Upstream `web-ext` tooling currently brings a dev-only `image-size` DoS advisory with no patched release; it is absent from the XPI and production dependency audit is clean.
