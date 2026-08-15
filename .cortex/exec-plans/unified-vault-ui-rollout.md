# Unified Vault — UI Rollout Plan

## Relationships

- [Unified Vault Architecture](../design-docs/unified-vault.md)
  - Defines the local canonical vault and provider fan-out model.
  - Read when changing vault storage or synchronization ownership.
- [Nook Coding Rules & Golden Principles](../rules.md)
  - Defines the repository-wide implementation and security constraints.
  - Apply while turning this design into code.

## Document map

- [Overview](#overview)
  - Gradual UI migration from provider-as-vault to local-first unified vault with optional sync providers.
  - Read before changing or relying on Overview.
- [Principles](#principles)
  - One page at a time — ship, test, merge each slice before moving on. Keep the app usable — feature-flag or parallel paths during.
  - Apply when making or reviewing decisions about Principles.
- [Progress tracker](#progress-tracker)
  - Summarizes the structured entries, ownership, and status for Progress tracker.
  - Read when assessing the current state of Progress tracker.
- [Phase 0 — Foundation (#61)](#phase-0--foundation-61)
  - Summarizes the structured entries, ownership, and status for Phase 0 — Foundation (#61).
  - Use while executing or reviewing Phase 0 — Foundation (#61).
- [Phase 1 — Login gate (#62, #71) ✅](#phase-1--login-gate-62-71-)
  - Target: Single unlock screen when local vault exists.
  - Use while executing or reviewing Phase 1 — Login gate (#62, #71) ✅.
- [Phase 2 — Sync providers (#63, #72) ✅](#phase-2--sync-providers-63-72-)
  - Summarizes the structured entries, ownership, and status for Phase 2 — Sync providers (#63, #72) ✅.
  - Use while executing or reviewing Phase 2 — Sync providers (#63, #72) ✅.
- [Phase 3 — Conflict dialog (#64, #73) ✅](#phase-3--conflict-dialog-64-73-)
  - Summarizes the structured entries, ownership, and status for Phase 3 — Conflict dialog (#64, #73) ✅.
  - Use while executing or reviewing Phase 3 — Conflict dialog (#64, #73) ✅.
- [Phase 4 — Secret vault fan-out (#65, #74) ✅](#phase-4--secret-vault-fan-out-65-74-)
  - Summarizes the structured entries, ownership, and status for Phase 4 — Secret vault fan-out (#65, #74) ✅.
  - Use while executing or reviewing Phase 4 — Secret vault fan-out (#65, #74) ✅.
- [Phase 5 — Onboard (#66, #75) ✅](#phase-5--onboard-66-75-)
  - Summarizes the structured entries, ownership, and status for Phase 5 — Onboard (#66, #75) ✅.
  - Use while executing or reviewing Phase 5 — Onboard (#66, #75) ✅.
- [Phase 6 — Help (#67, #76) ✅](#phase-6--help-67-76-)
  - Summarizes the structured entries, ownership, and status for Phase 6 — Help (#67, #76) ✅.
  - Use while executing or reviewing Phase 6 — Help (#67, #76) ✅.
- [Phase 7 — Join / multi-device (#68, #77) ✅](#phase-7--join--multi-device-68-77-)
  - Summarizes the structured entries, ownership, and status for Phase 7 — Join / multi-device (#68, #77) ✅.
  - Use while executing or reviewing Phase 7 — Join / multi-device (#68, #77) ✅.
- [Phase 8 — Migration & cleanup (#69, #78) ✅](#phase-8--migration--cleanup-69-78-)
  - Summarizes the structured entries, ownership, and status for Phase 8 — Migration & cleanup (#69, #78) ✅.
  - Use while executing or reviewing Phase 8 — Migration & cleanup (#69, #78) ✅.
- [Merge](#merge)
  - Squash-merge #79 (feat/unified-vault → main) per rules.md §6.
  - Use while executing or reviewing Merge.

## Overview

Gradual UI migration from **provider-as-vault** to **local-first unified vault** with optional sync providers. Work proceeds page-by-page so each step is reviewable and e2e-testable.

**Related:** [design-docs/unified-vault.md](../design-docs/unified-vault.md).  
**Epic:** [GitHub #70](https://github.com/meta-secret/nook/issues/70).

---

## Principles

1. **One page at a time** — ship, test, merge each slice before moving on.
2. **Keep the app usable** — feature-flag or parallel paths during transition if needed.
3. **E2E after every slice** — update Playwright specs in the same PR as UI changes.
4. **Rust-first sync logic** — UI calls the authored WASM API
   (`compare_vault_sync`); apply rules live in `nook-core`. Whole-blob
   reconciliation was superseded by event-log replication.
5. **Single merge PR** — epic ships as [#79](https://github.com/meta-secret/nook/pull/79) (`feat/unified-vault` → `main`); phase PRs #61–#78 were consolidated and closed.

---

## Progress tracker

| Phase | Issue | PR | Status |
|-------|-------|-----|--------|
| All (0–8) | [#70](https://github.com/meta-secret/nook/issues/70) | [#79](https://github.com/meta-secret/nook/pull/79) | Ready |

---

## Phase 0 — Foundation (#61)

| Deliverable | Location |
|-------------|----------|
| `vault_version` in vault YAML | `nook-app/nook-platform/nook-core/src/vault_format.rs` |
| `compare_vault_sync` | `nook-app/nook-platform/nook-core/src/vault_sync.rs` |
| WASM `compare_vault_sync` export | `nook-app/nook-platform/nook-wasm/src/vault_api.rs` |
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
| 2.5 | Manual sync via `compare_vault_sync` | `syncProviderById`, `manualSync` |

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
| 5.2 | Joining device: fetch remote → write local cache → unlock via `connect_with_password('local')` |
| 5.3 | Onboard picker shows `syncProviders` only; `ensureProviderSaved` preserves sync rows |
| 5.4 | Updated copy in locales + `EnrollmentQrOnboardCard` |

**E2E:** Updated `e2e/onboard-providers.spec.ts`, `e2e/password-envelope-local.spec.ts`; GitHub API stub for local enroll deep link.

---

## Phase 6 — Help (#67, #76) ✅

| # | Change |
|---|--------|
| 6.1 | Rewrite `content/help.ts` for local-first vault + sync providers |
| 6.2 | Sync / conflict / onboard FAQ sections |
| 6.3 | Architecture mermaid diagram in help page |

**E2E:** Updated `e2e/connect.spec.ts` help navigation assertions.

---

## Phase 7 — Join / multi-device (#68, #77) ✅

| # | Change |
|---|--------|
| 7.1 | Join requests on local vault; fan-out propagates `joins:` |
| 7.2 | `PendingJoinsBanner` sync layer |
| 7.3 | `JoinEnrollmentDialog` copy |

**E2E:** `e2e/multi-device-local.spec.ts` (stubbed GitHub sync + keys-mode local vault); existing `multi-device-github.spec.ts` unchanged.

---

## Phase 8 — Migration & cleanup (#69, #78) ✅

| # | Change |
|---|--------|
| 8.2 | Remove legacy login wizard (`LoginWizard`, `LoginConnectionStep`) |
| 8.4 | Update e2e helpers for local-first login |

**E2E:** Updated `login-unlock-flow`, `connect`, `provider-switch-passwords`, `remote-vault-recovery-github`.

---

## Merge

Squash-merge [#79](https://github.com/meta-secret/nook/pull/79) (`feat/unified-vault` → `main`) per [rules.md §6](../rules.md#6-git--pull-request-workflow).
