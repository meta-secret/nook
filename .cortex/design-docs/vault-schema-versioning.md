# Vault Schema Versioning (#52)

**Status:** Implemented (event-log migration path)  
**Issue:** [#52](https://github.com/meta-secret/nook/issues/52)  
**Related:** [vault-event-log.md](vault-event-log.md) (authoritative sync model)

## Decision

Issue #52 originally proposed **YAML schema v2** with `nook-vault.v2.yaml` and `nook-vault.meta.yaml` copy-on-upgrade. That path is **superseded** by the immutable event log ([#112](https://github.com/meta-secret/nook/issues/112)): the event set is the source of truth; projection YAML is a derived local cache only.

This document maps #52 goals to the implemented model and lists deferred work.

## Two version axes (unchanged from #52)

| Axis | Examples | Owned by |
|------|----------|----------|
| **App semver** | `nokey.sh` stable, `dev.nokey.sh` current development | CI / GitHub Pages + Cloudflare Pages |
| **Projection `schema_version`** | `1` today in `nook-projection.yaml` cache | `nook-core` `vault_format.rs` |
| **Event `schema_version`** | `2` on signed YAML event bodies | `nook-core` `vault_event.rs` |
| **Password envelope `version`** | Crypto wrap inside `password_entries` | `password_envelope.rs` |

## #52 goal → implementation

| #52 goal | Status | How |
|----------|--------|-----|
| Explicit `schema_version` in vault YAML | **Done** | Top-level field on projection cache; missing → `1` |
| Copy-on-upgrade, never destroy only copy | **Done (event path)** | `source_backup:{store_id}` in IndexedDB on first import; remote projection artifacts are no longer overwritten |
| Active-vault pointer (`nook-vault.meta.yaml`) | **Superseded** | Event-log heads + set union across providers |
| Verification before cutover | **Done** | `verify_stored_vault_import` compares secret ids before append |
| Lazy migration on connect | **Done** | `import_stored_vault_to_event_log` → `vault-imported` genesis event |
| IndexedDB parity | **Done** | Same backup + event store keys for local-only users |
| Migration status events | **Done** | `MIGRATION_START` / `MIGRATION_SUCCESS` on WASM status channel |
| `nokey.sh` stable app rollback | **Done** | `release/v1` branch deploys the stable GitHub Pages artifact |
| Migration wizard UX | **Deferred** | Connect-time import is automatic; optional explicit gate later |
| `nook-vault.v2.yaml` side-by-side files | **Not planned** | Event log replaces scalar blob versioning |

## Safe migration flow (current)

```text
1. User connects / unlocks source projection YAML
2. WASM saves byte-for-byte backup → source_backup:{store_id} (if absent)
3. verify_stored_vault_import(ctx, event) — secret id parity
4. Append vault-imported genesis event locally
5. Flush outbox → append-only event files/records on configured providers
   (GitHub, Google Drive, iCloud), repairing missing local events per provider
6. Projection cache rewritten with schema_version: 1
```

Remote projection YAML (if present) is **read-only** for import; writes go to
the provider's append-only event log (`nook-log/v1/events/...` on file-backed
providers, `NookVaultEvent` records on iCloud) only.

## Current schema support

| App | Projection schema read | Projection schema write | Event schema |
|-----|------------------------|-------------------------|--------------|
| Current | `1` only | `1` | reads `2`, writes `2` |

Opening a projection with `schema_version > 1` fails with an actionable error (upgrade the app).

## v1 stable release

`nokey.sh` is the stable first-release channel. It is built from the
`release/v1` branch by `.github/workflows/release-v1.yml`, using the same
production Docker gate as `main` (`task ci:main ... WASM_BUILD_MODE=prod`) and
then deploying a stable `dist` artifact to GitHub Pages. The deploy build passes
`VITE_SITE_URL=https://nokey.sh` and
`VITE_PUBLIC_APP_URL=https://nokey.sh` so generated release metadata and
enrollment links use the stable root host while the pre-deploy e2e gate keeps
local Playwright URLs.

`dev.nokey.sh` is the active development channel for `main`. `.github/workflows/main.yml`
keeps the normal main verification and toolchain publish path, then deploys a
development artifact to Cloudflare Pages with
`VITE_SITE_URL=https://dev.nokey.sh` and
`VITE_PUBLIC_APP_URL=https://dev.nokey.sh`. The workflow also ensures the
Cloudflare Pages custom domain exists and verifies the preconfigured
Cloudflare DNS CNAME and HTTPS response for `dev.nokey.sh`.

Maintenance rule: `release/v1` should only receive cherry-picked critical fixes
from `main`; do not continue normal feature development there. If a future app
version changes event or projection compatibility, keep `nokey.sh` on the
compatible stable branch until the migration/rollback policy for existing vaults
is explicit.

## Deferred (#52 non-goals retained)

- Settings UI to remove source backup (opt-in destructive)
- Re-migration after user edits on a hypothetical v1 app post-cutover
