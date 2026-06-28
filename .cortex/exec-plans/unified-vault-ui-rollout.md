# Unified Vault — UI Rollout Plan

Gradual UI migration from **provider-as-vault** to **local-first unified vault** with optional sync providers. Work proceeds page-by-page so each step is reviewable and e2e-testable.

**Related:** [design-docs/unified-vault.md](../design-docs/unified-vault.md).

---

## Principles

1. **One page at a time** — ship, test, merge each slice before moving on.
2. **Keep the app usable** — feature-flag or parallel paths during transition if needed.
3. **E2E after every slice** — update Playwright specs in the same PR as UI changes.
4. **Rust-first sync logic** — UI only calls WASM (`compareVaultSync`, version getters); no sync rules in TypeScript.

---

## Phase 0 — Foundation (this PR)

| Deliverable | Location |
|-------------|----------|
| `vault_version` in vault YAML | `nook-core/src/vault_format.rs` |
| `compare_vault_sync` | `nook-core/src/vault_sync.rs` |
| WASM `compareVaultSync` export | `nook-wasm/src/lib.rs` |
| Architecture docs | `.cortex/design-docs/unified-vault.md` |
| This rollout plan | `.cortex/exec-plans/unified-vault-ui-rollout.md` |

No user-visible UI changes yet.

---

## Phase 1 — Login gate (`LoginGate`)

**Current:** Two-step wizard — (1) pick storage provider, (2) unlock method.

**Target:** Single unlock screen when local vault exists.

| # | Change | Component | Test id / e2e |
|---|--------|-----------|---------------|
| 1.1 | Detect local vault on init; skip provider picker when present | `VaultState.init()` | `login-local-vault-detected` |
| 1.2 | Replace connection step with **master password** field as primary unlock | `LoginGate`, new `LoginUnlockStep` | `login-master-password-input`, `unlock-vault-btn` |
| 1.3 | Move "first-time setup" to **Create vault** flow: set password → create local vault | `LoginGate` (no providers variant) | `login-create-vault-btn` |
| 1.4 | Collapse provider management into "Sync later" link (Settings) | Remove `LoginConnectionStep` from default path | — |
| 1.5 | Keep device-key unlock as advanced option (accordion) | `LoginAuthorizationStep` (simplified) | `login-unlock-method-keys` |
| 1.6 | Update copy: "Your vault lives on this device" | `ProductIntro`, locale catalogs | — |

**E2E:** Rewrite `e2e/login-unlock-flow.spec.ts` for password-first local unlock.

**Exit criteria:** New user creates local vault with password; returning user unlocks without picking a provider.

---

## Phase 2 — Settings: sync providers (`AuthStorage` / `VaultSettingsAccordion`)

**Current:** Providers list with "active provider" switch; reconnect reloads vault from that provider.

**Target:** Sync providers are optional replicas; local vault is always canonical.

| # | Change | Component |
|---|--------|-----------|
| 2.1 | Rename "Storage providers" → **Sync providers** | `VaultSettingsAccordion`, locale |
| 2.2 | Remove "active provider" concept — all enabled providers sync | `VaultState`, `auth-providers.ts` → `sync-providers.ts` |
| 2.3 | **Add sync provider** flow: connect credentials → fetch remote → reconcile | New `SyncProviderSetup` |
| 2.4 | Show per-provider sync status (version, last synced) | `AuthStorage` row metadata |
| 2.5 | **Reconnect** → re-run `compareVaultSync`, not full vault reload | `VaultState.manualSync()` |

**E2E:** Add `e2e/sync-provider-connect.spec.ts` — local vault + GitHub push on connect.

---

## Phase 3 — Conflict resolution dialog

**Trigger:** `compareVaultSync` returns `conflict`.

| # | Change | Component |
|---|--------|-----------|
| 3.1 | Modal: "Local and remote vaults diverged" with version + timestamp | `VaultSyncConflictDialog` |
| 3.2 | Actions: **Keep local** / **Keep remote** | Calls WASM push or adopt path |
| 3.3 | Block vault edits until conflict resolved | `VaultState.syncBlocked` flag |
| 3.4 | Show conflict banner in status bar | `VaultStatusBar` |

**E2E:** `e2e/sync-conflict-resolution.spec.ts` with fixture vaults at same version.

---

## Phase 4 — Secret vault (`SecretVault`)

Minimal changes — vault CRUD stays the same once unlocked.

| # | Change | Component |
|---|--------|-----------|
| 4.1 | After save, fan-out push to all enabled sync providers | `VaultState.handleAddSecret` etc. |
| 4.2 | Status bar shows "Syncing to GitHub…" per provider | `VaultStatusBar` |
| 4.3 | Remove storage-mode icon dependency on active provider | `VaultStatusBar` |

---

## Phase 5 — Onboard (`OnboardDevice`)

**Current:** QR bundles provider credentials + vault password.

**Target:** QR bundles sync provider + enrollment keys; vault is always local-first on new device.

| # | Change |
|---|--------|
| 5.1 | Enrollment code references sync provider for initial pull, not vault location |
| 5.2 | New device: create local cache from remote, then unlock with password |
| 5.3 | Update `EnrollmentQrOnboardCard` copy |

---

## Phase 6 — Help (`HelpPage`)

| # | Change |
|---|--------|
| 6.1 | Rewrite architecture section for unified vault model |
| 6.2 | Add sync / conflict resolution FAQ |
| 6.3 | Update mermaid diagrams in `help-content.ts` |

---

## Phase 7 — Join / multi-device flows

| # | Change |
|---|--------|
| 7.1 | Join requests operate on local vault; sync propagates `joins:` to providers |
| 7.2 | `PendingJoinsBanner` unchanged visually; sync layer updated |
| 7.3 | `JoinEnrollmentDialog` — clarify device keys vs master password |

---

## Phase 8 — Migration & cleanup

| # | Change |
|---|--------|
| 8.1 | One-time migration: copy active provider vault → local `encrypted_db` |
| 8.2 | Deprecate `LoginConnectionStep`, `LoginWizard` two-step flow |
| 8.3 | Remove `activeProviderId` from auth snapshot |
| 8.4 | Update all e2e helpers (`resetBrowserState`) |

---

## Suggested PR sequence

| PR | Scope |
|----|-------|
| **#1 (this)** | Core versioning + docs + rollout plan |
| **#2** | Phase 1 — Login gate |
| **#3** | Phase 2 — Sync providers in Settings |
| **#4** | Phase 3 — Conflict dialog |
| **#5** | Phases 4–5 — Vault fan-out + Onboard |
| **#6** | Phases 6–8 — Help, multi-device, migration cleanup |

Each PR should be squash-merged independently per [rules.md §6](../rules.md#6-git--pull-request-workflow).
