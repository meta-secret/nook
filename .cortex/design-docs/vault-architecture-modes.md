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

`vault_type=nexus` never writes per-device full vault-key auth envelopes for the
protected key epoch. Genesis keeps vault keys in session memory and enrolls the
first participant into the member roster only. As additional devices are
approved, Rust issues encrypted `nexus_share:{device_id}` records once the
configured `required_participants` count is reached.

`load_stored_vault` rejects single-device unlock for nexus vaults. Threshold
reconstruction uses `load_nexus_vault` with enough participant identities.
Secret creation stays blocked until actual share records exist
(`can_create_secret_with_records`); UI `ready_participants` is presentation
only.

Share math is currently interim GF(256) Shamir inside `nook-auth2`. Product
SLIP-0039 mnemonic primitives remain owned by #261 and should replace this
encoding later without changing the architecture-mode contract.

## Shared Replication Grant

Shared onboarding collects the joiner provider identity (email for Google Drive)
and embeds a `SharedProviderGrant` enrollment payload without owner credentials.
`prepare_shared_storage_grant` owns the grant ceremony decision in Rust.

Google Drive sync currently uses OAuth `drive.appdata`, which is not shareable
through Drive `permissions.create`. Until shareable storage targets exist, the
contract returns `ManualGrantRequired` with localized owner instructions. The
joiner then signs into their own provider account before redeeming the code.

## Web Boundary

Svelte components may render mode choices and disabled reasons, but they must
call WASM/Rust for validation, onboarding type, provider capability, and secret
creation readiness. Do not recreate the matrix as independent TypeScript policy.
