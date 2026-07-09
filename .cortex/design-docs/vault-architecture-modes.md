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

`vault_type=nexus` currently establishes the product contract and readiness
gate. A nexus vault requires a threshold policy and blocks first secret creation
until all required participants are ready. Low-level SLIP-0039 share generation,
combination, and recovery envelope implementation remains owned by the quorum
work tracked from #259/#261/#262; do not duplicate that primitive in UI code.

## Web Boundary

Svelte components may render mode choices and disabled reasons, but they must
call WASM/Rust for validation, onboarding type, provider capability, and secret
creation readiness. Do not recreate the matrix as independent TypeScript policy.
