# Vault Architecture Modes

Nook's vault architecture modes are grouped, not a flat list of peer flags.
Rust owns the compatibility matrix in `nook-core::vault_architecture`; WASM
exports those decisions to the web layer.

## Groups

| Group | Values | Owner | Notes |
| --- | --- | --- | --- |
| `device_mode` | `standard`, `anti-hacker` | `nook-auth2` / `nook-core` | Per-device local age/device identity protection. |
| `vault_type` | `simple`, `nexus` | `nook-core` | Vault key-access model. |
| `replication_type` | `personal`, `shared` | `nook-core` | Sync-provider credential/account trust model. |
| `onboarding_type` | derived | `nook-core` | Derived from `replication_type` and provider capability. |
| `sync_provider_type` | provider-specific | `nook-core` | Capability declaration for personal/shared replication. |

## Defaults And Persistence

Existing vault YAML with no `architecture:` field migrates in memory to:

```yaml
architecture:
  device_mode: standard
  vault_type: simple
  replication_type: personal
```

The default is omitted on write to keep legacy simple vault YAML compact.
Non-default architecture metadata is persisted as a top-level `architecture:`
field in projection YAML and is mirrored through the WASM session state.

Device-local `anti-hacker` material never belongs in vault YAML, provider
snapshots, event logs, app logs, or onboarding payloads. The local record is the
`passkey-wrapped-local` `device_identity_wrapped` IndexedDB value.

## Provider Capability Matrix

| Provider | Personal | Shared | Shared identity |
| --- | --- | --- | --- |
| Local browser storage | yes | no | n/a |
| Local folder backup | yes | no | n/a |
| GitHub | yes | no | n/a |
| Google Drive OAuth file | yes | yes | email |
| iCloud OAuth file | yes | no | n/a |

Unsupported provider/replication combinations fail closed in Rust before an
onboarding code is produced.

## Nexus Lifecycle

`vault_type=nexus` stores encrypted `nexus_share:{device_id}` records in the
top-level `nexus_shares:` YAML section. The vault key bundle is split across
participant shares with a threshold policy, and the normal single-device auth
envelope path must not unlock a nexus vault.

A nexus vault blocks secret creation until the manager can see enough actual
share records for the configured policy. UI metadata such as
`ready_participants` is only presentation state; Svelte must call WASM/Rust for
readiness so stale metadata cannot enable writes.

The current implementation provides the encrypted share record model and
fail-closed creation gate. Higher-level ceremony UX for distributing,
rotating, or recovering shares should build on these records rather than
placing share math in TypeScript.

## Web Boundary

Svelte components may render mode choices and disabled reasons, but they must
call WASM/Rust for validation, onboarding type, provider capability, and secret
creation readiness. Do not recreate the matrix as independent TypeScript policy.
