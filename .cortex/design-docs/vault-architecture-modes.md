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

## UX Screen And State Map

The five groups stay visually distinct even though Rust derives some of them.
The web layer renders the current Rust/WASM decision; it does not maintain a
second compatibility matrix.

Selectable alternatives use compact dropdowns for vault and replication type,
with only the selected mode's description shown below each control. Derived
onboarding and provider-capability details are omitted from vault creation and
shown later only where the user can act on them.

| Stage / surface | Group shown | State and transition |
| --- | --- | --- |
| Device protection gate | 1. Device mode | Choose `standard` or `anti-hacker` while initializing this browser. The persisted choice is reused and is never requested again during vault creation. |
| First-run create chooser | 2. Vault type | Choose the fast `simple` path or `nexus`; choosing nexus immediately shows the pre-secret readiness gate. |
| First-run create chooser | 3. Replication type | Choose `personal` or `shared` independently from vault key access. |
| Provider picker | 5. Provider capability | Ask Rust/WASM for each provider capability and disable unsupported combinations before setup. |
| Unlocked Onboard Device wizard | 4 + 5 | Show the derived onboarding ceremony, label saved providers as personal-only or shared-capable, and select only a provider Rust accepts for the vault replication mode. |
| Unlocked provider management | 5 | Keep incompatible saved rows visible for explanation/removal, label their capability, and disable sync actions for the current vault mode. |
| Nexus creation / unlocked vault | 2 + 4 | Secret creation remains blocked until encrypted participant shares satisfy the Rust-owned readiness rule. |
| Nexus login | 2 + 4 | Replace password unlock with the dedicated opened-share ceremony. |

Simple personal remains the default and keeps the local create action on the
same screen. Shared and nexus choices reveal their constraints before provider
setup or secret creation, so the low-friction path is not buried by the
high-security ceremony.

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
Architecture selection is immutable once a vault has a `store_id`; changing a
simple vault into nexus (or the reverse) would reinterpret existing key-access
records and is rejected instead of treated as an in-place migration.

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

Password unlock is forbidden as the sole unlock path for nexus vaults
(`NexusPasswordUnlockForbidden`). Session hydrate from projection YAML also
fails closed (`NexusCeremonyRequired`) and must never resolve auth envelopes.
Projection serialization and nexus load validate the records against the
architecture: nexus rejects every full `auth:` key envelope, while simple
rejects nexus shares. An issued nexus share set must be complete, have unique
device ids and share indexes, and match the persisted threshold/participant
policy. Share issuance is one atomic `NexusSharesIssued` operation after the
required roster is ready; there is no persistable partial-share onboarding
state. Partial, malformed-prefix, or mixed share generations fail closed.

Browser unlock is an opened-share ceremony: each device opens its local share
into an `OpenedNexusShare` contribution (`open_nexus_share_for_identity` /
WASM `openLocalNexusShare`), then the reconstructing device combines ≥
threshold contributions (`reconstruct_nexus_vault_keys_from_opened` /
WASM `connectWithNexusShares`). Peer `DeviceIdentity` secrets must never cross
browsers.

`load_stored_vault` rejects nexus unlock. `load_nexus_vault` (identities) is a
native/test helper only; production browser paths use
`load_nexus_vault_from_opened`. Secret creation stays blocked until actual
share records exist (`can_create_secret_with_records`); UI
`ready_participants` is presentation only.

Share math is currently interim GF(256) Shamir inside `nook-auth2`. Product
SLIP-0039 mnemonic primitives remain owned by #261 and should replace this
encoding later without changing the architecture-mode contract.

Generic device revocation/key rotation is not valid for nexus because it would
either write a full current-device key envelope or strand the new epoch behind
old shares. Nexus revocation therefore fails closed until an atomic participant
replacement plus share-rotation event is implemented.

## Shared Replication Grant

Shared onboarding collects the joiner provider identity (email for Google Drive)
and embeds a `SharedProviderGrant` enrollment payload without owner credentials.
Rust `prepare_shared_storage_grant` validates the request; WASM performs the
real Google Drive grant when possible.

**Personal** Google Drive vaults stay on OAuth `drive.appdata` (unchanged).

**Shared** Google Drive vaults use a dedicated My Drive folder under
`drive.file`:

1. Owner: create folder → `permissions.create` for the joiner email (writer) →
   return `Granted` with `storageTargetId` (folder id) and optional name.
2. Enrollment embeds `storage_target_id` on `SharedProviderGrant` (no owner
   tokens).
3. Joiner: own OAuth with `drive.file`, redeem with the folder id, sync events
   under that parent (not `appDataFolder`).

`ManualGrantRequired` remains the fallback when the Drive API fails or the
owner token lacks `drive.file`.

## Web Boundary

Svelte components may render mode choices and disabled reasons, but they must
call WASM/Rust for validation, onboarding type, provider capability, and secret
creation readiness. Do not recreate the matrix as independent TypeScript policy.
