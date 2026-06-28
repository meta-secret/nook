# Unified Vault Architecture

This document defines Nook's target architecture: **one logical vault per user**, stored locally first, unlocked with a single master password, and replicated to optional sync providers with version-based reconciliation.

**Related:** [auth-providers.md](auth-providers.md), [secret-store-identity.md](secret-store-identity.md), [ARCHITECTURE.md](../ARCHITECTURE.md) §4, [exec-plans/unified-vault-ui-rollout.md](../exec-plans/unified-vault-ui-rollout.md).

---

## 1. Problem with the current model

Today each saved **storage provider** can point at a **separate vault file**. The login wizard asks "where is the encrypted vault?" before "how do you decrypt it?" — treating provider choice as vault selection.

That leads to:

- Duplicate vaults across Local / GitHub / Drive with no automatic reconciliation.
- User confusion: switching providers switches databases.
- Sync is provider-scoped (`sync_vault_from_storage` polls only the active backend).

---

## 2. Target model

```mermaid
flowchart TB
  subgraph local["Browser (always)"]
    V[nook-vault.yaml in nook_db]
    P[Master password unlock]
  end
  subgraph sync["Optional sync providers"]
    G[GitHub]
    D[Google Drive]
  end
  V <-->|"version-based sync"| G
  V <-->|"version-based sync"| D
  P --> V
```

| Concept | Old | New |
|---------|-----|-----|
| **Primary vault location** | Whichever provider is active | Always local IndexedDB (`nook_db.encrypted_db`) |
| **Unlock** | Device keys first, backup passwords optional | Master password first (device keys remain for multi-device) |
| **Storage providers** | Vault selectors | Sync destinations only |
| **Multiple providers** | Independent vaults per provider | Replicas of the **same** `store_id` |
| **Conflict handling** | Last poll wins (implicit) | Explicit user choice |

---

## 3. Local-first storage

### IndexedDB layout (`nook_db`)

| Key | Value | Notes |
|-----|-------|-------|
| `encrypted_db` | UTF-8 vault YAML | **Authoritative local copy** — always present after first setup |
| `device_identity_secret` | age X25519 secret | Never synced |
| `device_id` | Short fingerprint | UI only |

The local vault is created on first setup and persists regardless of which sync providers are connected.

### IndexedDB layout (`nook_auth`) — sync providers only

| Key | Value |
|-----|-------|
| `sync_providers` | `{ providers: SyncProvider[], enabled: string[] }` |

```typescript
interface SyncProvider {
  id: string
  type: 'github' | 'oauth-file'
  label: string
  githubPat?: string
  githubRepo?: string
  oauthFile?: OAuthFileConfig
  /** Last known remote vault_version after successful sync */
  lastSyncedVersion?: number
  createdAt: string
}
```

Provider credentials are **sync convenience**, not vault encryption. The master password and vault keys stay in the vault file.

---

## 4. Vault versioning

Every vault YAML carries a monotonic counter:

```yaml
vault_version: 42
store_id: store_SMypl8K0w9Y
secrets:
  - id: secret_k9Qx2mNp4Rt
    ...
```

| Rule | Behaviour |
|------|-----------|
| **Genesis** | `vault_version: 1` on first persist |
| **Every save** | Increment before write |
| **Legacy vaults** | Missing field → treat as `0`; next save normalizes to `1+` |
| **JSONL legacy** | Version always `0` until migrated to YAML |

Implementation: `nook-core/src/vault_format.rs` (`read_vault_version`), `nook-core/src/vault_sync.rs`.

---

## 5. Sync reconciliation

When comparing local vs remote vault blobs (`compare_vault_sync`):

```mermaid
flowchart TD
  A[Compare local vs remote] --> B{Byte-identical?}
  B -->|yes| U[unchanged]
  B -->|no| C{One side empty?}
  C -->|local empty| R[adopt_remote]
  C -->|remote empty| P[push_local]
  C -->|both have data| D{store_id match?}
  D -->|mismatch| E[error — different vaults]
  D -->|match| F{Compare vault_version}
  F -->|remote higher| R
  F -->|local higher| P
  F -->|equal, different content| X[conflict — user picks]
  F -->|equal, same hash| U
```

| Action | Meaning | Automatic? |
|--------|---------|------------|
| `unchanged` | Nothing to do | Yes |
| `adopt_remote` | Overwrite local with remote | Yes |
| `push_local` | Overwrite remote with local | Yes |
| `conflict` | Same version, diverged content | **No** — show resolution UI |

**Conflict UI** offers exactly two choices:

1. **Keep local** — push local copy to remote (bumps version).
2. **Keep remote** — replace local with remote copy.

No automatic merge of secret records at this stage.

WASM export: `compareVaultSync(local, remote)` for compare-only; `reconcileVaultBlobs(local, remote, revision)` returns post-reconcile blobs and action label.

---

## 6. Connect / unlock flow (target)

```mermaid
stateDiagram-v2
  [*] --> CheckLocal: app init
  CheckLocal --> CreateVault: no local vault
  CheckLocal --> Unlock: local vault exists
  CreateVault --> SetPassword: user sets master password
  SetPassword --> Vault: unlock success
  Unlock --> Vault: password correct
  Vault --> SyncSetup: user adds sync provider (optional)
  SyncSetup --> Reconcile: remote vault exists
  SyncSetup --> Push: remote empty
  Reconcile --> Vault: auto or user-resolved
  Push --> Vault
```

1. **Always load local vault first** — no provider picker on unlock.
2. **Master password** decrypts the vault (via `password_entries` or primary envelope).
3. **After unlock**, user may connect sync providers in Settings.
4. **On provider connect**, fetch remote → `compareVaultSync` → act or prompt.

Device-key multi-device flows (`auth:`, `joins:`, `members:`) continue to work alongside password unlock — they are orthogonal to sync.

---

## 7. Migration from current model

| Current state | Migration |
|---------------|-----------|
| User with one local provider | No change — already local-first |
| User with GitHub-only provider | On upgrade: copy remote vault into `encrypted_db`, switch to local-first reads |
| User with multiple providers (different vaults) | Prompt: pick one vault to keep as canonical; others become disconnected |
| Missing `vault_version` | Backfill on next save |

Migration runs once on `VaultState.init()` when detecting legacy provider-as-vault model.

---

## 8. Security notes

- Master password never leaves the browser; used only to unwrap vault keys in WASM.
- Sync provider tokens (GitHub PAT, OAuth) remain in `nook_auth` — compromise exposes encrypted blob access, not plaintext.
- `store_id` mismatch between local and remote is a hard error — prevents accidental cross-vault overwrite.
- Conflict resolution is explicit — Nook never silently merges diverged vaults.

---

## 9. Fan-out sync on mutation

After any local vault save (secret CRUD, join approve/deny, device roster change — phased rollout), the web layer pushes to **all connected sync providers**:

1. Read authoritative blob from `nook_db.encrypted_db` (`readLocalVaultYaml`).
2. For each non-local provider in `nook_auth`: `reconcileVaultBlobs` → push/adopt/conflict.
3. Background fan-out is **quiet** (no per-provider toast spam); status bar shows `Syncing to {provider}…`.

Background **pull** (sync timer, `PendingJoinsBanner` refresh) reconciles every sync provider into the local vault, then `hydrateMultiDeviceState()` reads pending `joins:` from the unlocked session.

Manual **Sync all** in the status bar runs the same reconcile loop with user-visible toasts.

### In-memory sync tests

`MemoryVaultStore` in `nook-core/src/vault_sync_store.rs` is a HashMap-friendly stand-in for local IndexedDB and remote providers. `reconcile_vault_stores` and `fan_out_sync` apply the same actions as the web layer after I/O. Integration coverage lives in `nook-core/tests/vault_sync_workflow.rs` (no browser required).

---

## 10. Implementation status

| Piece | Status |
|-------|--------|
| `vault_version` in YAML read/write | Done (#61) |
| `compare_vault_sync` in `nook-core` | Done (#61) |
| In-memory sync replication tests (`vault_sync_store`) | Done |
| `compareVaultSync` WASM export | Done (#61) |
| `reconcileVaultBlobs` WASM export (apply in core) | Done |
| Version increment on save | Done (#61) |
| Local-first login gate | Done (#71, Phase 1) |
| Sync providers in Settings | Done (#72, Phase 2) |
| Session-independent sync I/O (`sync_io.rs`) | Done (#72) |
| Conflict resolution UI | Done (#73, Phase 3) |
| Fan-out sync after secret CRUD | Done (#74, Phase 4) |
| Local-first status bar | Done (#74, Phase 4) |
| Onboard / enrollment QR (local-first) | Done (#75, Phase 5) |
| Help page rewrite | Done (#76, Phase 6) |
| Join sync propagation | Done (#77, Phase 7) |
| Legacy multi-vault migration | Done (#78, Phase 8) |

UI rollout details: [exec-plans/unified-vault-ui-rollout.md](../exec-plans/unified-vault-ui-rollout.md).
