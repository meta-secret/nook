# Unified Vault — UI Rollout Plan

Gradual UI migration from **provider-as-vault** to **local-first unified vault** with optional sync providers. Work proceeds page-by-page so each step is reviewable and e2e-testable.

**Related:** [design-docs/unified-vault.md](../design-docs/unified-vault.md).  
**Epic:** [GitHub #70](https://github.com/meta-secret/nook/issues/70).

---

## Principles

1. **One page at a time** — ship, test, merge each slice before moving on.
2. **Keep the app usable** — feature-flag or parallel paths during transition if needed.
3. **E2E after every slice** — update Playwright specs in the same PR as UI changes.
4. **Rust-first sync logic** — UI calls WASM (`reconcileVaultBlobs`, `compareVaultSync`); apply rules live in `nook-core`.
5. **Stacked PRs** — each phase branches from the previous; squash-merge in order (#61 → #71 → #72 → …).

---

## Progress tracker

| Phase | Issue | PR | Status |
|-------|-------|-----|--------|
| 0 Foundation | — | [#61](https://github.com/meta-secret/nook/pull/61) | Merged / base |
| 1 Login gate | [#62](https://github.com/meta-secret/nook/issues/62) | [#71](https://github.com/meta-secret/nook/pull/71) | Ready |
| 2 Sync providers | [#63](https://github.com/meta-secret/nook/issues/63) | [#72](https://github.com/meta-secret/nook/pull/72) | Ready |
| 3 Conflict dialog | [#64](https://github.com/meta-secret/nook/issues/64) | [#73](https://github.com/meta-secret/nook/pull/73) | Ready |
| 4 Fan-out sync | [#65](https://github.com/meta-secret/nook/issues/65) | [#74](https://github.com/meta-secret/nook/pull/74) | Ready |
| 5 Onboard | [#66](https://github.com/meta-secret/nook/issues/66) | [#75](https://github.com/meta-secret/nook/pull/75) | Ready |
| 6 Help | [#67](https://github.com/meta-secret/nook/issues/67) | #76 (pending) | Ready |
| 7 Multi-device | [#68](https://github.com/meta-secret/nook/issues/68) | — | Planned |
| 8 Migration | [#69](https://github.com/meta-secret/nook/issues/69) | — | Planned |

---

## Phase 0 — Foundation (#61)

| Deliverable | Location |
|-------------|----------|
| `vault_version` in vault YAML | `nook-core/src/vault_format.rs` |
| `compare_vault_sync` | `nook-core/src/vault_sync.rs` |
| WASM `compareVaultSync` export | `nook-wasm/src/lib.rs` |
| Architecture docs | `.cortex/design-docs/unified-vault.md` |
| This rollout plan | `.cortex/exec-plans/unified-vault-ui-rollout.md` |

No user-visible UI changes yet.

---

## Phase 1 — Login gate (#62, #71) ✅

**Target:** Single unlock screen when local vault exists.

| # | Change | Component |
|---|--------|-----------|
| 1.1 | Detect local vault on init | `VaultState.init()`, `local-vault.ts` |
| 1.2 | Master password primary unlock | `LoginUnlockStep`, `LoginCreateVaultStep` |
| 1.3 | Create vault flow | `LoginGate` |
| 1.4 | Legacy provider wizard escape hatch | `LoginGate` |
| 1.5 | Device-key unlock accordion | `LoginAuthorizationStep` |

**E2E:** `e2e/login-unlock-flow.spec.ts`

---

## Phase 2 — Sync providers (#63, #72) ✅

| # | Change | Component |
|---|--------|-----------|
| 2.1 | Rename → **Sync providers** | `VaultSettingsAccordion`, locales |
| 2.2 | Local vault canonical; no active switch | `VaultState`, `AuthStorage` |
| 2.3 | Connect + reconcile flow | `connectAndSyncStagedProvider`, `sync_io.rs` |
| 2.4 | Per-provider sync status | `AuthStorage` |
| 2.5 | Manual sync via `compareVaultSync` | `syncProviderById`, `manualSync` |

**E2E:** `e2e/sync-provider-connect.spec.ts`, updated `connect.spec.ts`

---

## Phase 3 — Conflict dialog (#64, #73) ✅

| # | Change | Component |
|---|--------|-----------|
| 3.1 | Conflict modal | `VaultSyncConflictDialog` |
| 3.2 | Keep local / Keep remote | `resolveSyncConflictKeepLocal/Remote` |
| 3.3 | Block edits until resolved | `syncBlocked`, `SecretVault` |
| 3.4 | Status bar banner | `VaultStatusBar` |

**E2E:** `e2e/sync-conflict-resolution.spec.ts`

---

## Phase 4 — Secret vault fan-out (#65, #74) ✅

| # | Change | Component |
|---|--------|-----------|
| 4.1 | Fan-out push after secret CRUD | `fanOutSyncToProviders`, `scheduleFanOutSyncAfterLocalSave` |
| 4.2 | Status bar: local vault + sync activity | `VaultStatusBar` (`vault-sync-out-status`) |
| 4.3 | Remove active-provider icon dependency | Status bar always shows local icon when authenticated |

**E2E:** `e2e/sync-fanout.spec.ts`; update `github-vault.spec.ts` for local-first status bar.

---

## Phase 5 — Onboard (#66, #75) ✅

| # | Change |
|---|--------|
| 5.1 | Enrollment QR embeds **sync provider** credentials (GitHub), not local vault |
| 5.2 | Joining device: fetch remote → write local cache → unlock via `connectWithPassword('local')` |
| 5.3 | Onboard picker shows `syncProviders` only; `ensureProviderSaved` preserves sync rows |
| 5.4 | Updated copy in locales + `EnrollmentQrOnboardCard` |

**E2E:** Updated `e2e/onboard-providers.spec.ts`, `e2e/password-envelope-local.spec.ts`; GitHub API stub for local enroll deep link.

---

## Phase 6 — Help (#67, #76) ✅

| # | Change |
|---|--------|
| 6.1 | Rewrite `help-content.ts` for local-first vault + sync providers |
| 6.2 | Sync / conflict / onboard FAQ sections |
| 6.3 | Architecture mermaid diagram in help page |

**E2E:** Updated `e2e/connect.spec.ts` help navigation assertions.

---

## Phase 7 — Join / multi-device (#68)

| # | Change |
|---|--------|
| 7.1 | Join requests on local vault; fan-out propagates `joins:` |
| 7.2 | `PendingJoinsBanner` sync layer |
| 7.3 | `JoinEnrollmentDialog` copy |

---

## Phase 8 — Migration & cleanup (#69)

| # | Change |
|---|--------|
| 8.1 | Copy active provider vault → local `encrypted_db` |
| 8.2 | Deprecate legacy login wizard paths |
| 8.3 | Remove `activeProviderId` from auth snapshot |
| 8.4 | Update e2e helpers |

---

## Stacked PR merge order

```
main ← #61 ← #71 ← #72 ← #73 ← #74 ← …
```

Each PR squash-merged independently per [rules.md §6](../rules.md#6-git--pull-request-workflow).
