# Vault Architecture Modes

**Status:** Implemented.

Nook's security choices belong to their owning lifecycle. Rust owns policy in
`nook-core` / `nook-auth2`; WASM exposes typed decisions to the web layer.
Vault creation chooses only the vault key-access model. Replication is a
post-creation storage concern, not a vault mode.

## Architecture Groups

| Group | Values | Owner | Notes |
| --- | --- | --- | --- |
| `device_mode` | `standard`, `anti-hacker` | `nook-auth2` / `nook-core` | Per-device local identity protection. The UI calls the latter High security. |
| `vault_type` | `simple`, `nexus` | `nook-core` | Vault key-access lifecycle. This is the only vault-type choice during creation. |
| Nexus policy | participant count `N`, threshold `T` | `nook-auth2` / `nook-core` | Chosen only for Nexus genesis before vault keys exist. |
| Sync provider | provider-specific connection | `nook-core` / `nook-wasm` | Optional post-genesis encrypted backup/replica transport. Not a vault mode or unlock factor. |

`replication_type` and its derived `onboarding_type` are legacy implementation
concepts. Provider account ownership or sharing capability belongs to an
individual provider connection; it does not alter the vault's cryptographic
access model.

## Creation and Import UX

Creation and import are separate top-level workflows. Creation asks for vault
type first and then branches because Simple and Nexus have fundamentally
different lifecycles.

| Stage / surface | Choice or state | Transition |
| --- | --- | --- |
| Device protection gate | Device mode | Initialize or authorize this browser's protected device identity once. Never ask again during vault creation. |
| Create, step 1 | Vault type | Choose `simple` or `nexus`. There is no replication selector. |
| Simple branch | Vault name/action | Create an empty local vault in memory and open it with this device's normal key access. Offer sync later in Settings. |
| Nexus branch | Nexus policy | Choose participant count `N` and unlock threshold `T`; start reverse onboarding instead of creating/opening a vault. |
| Nexus reverse onboarding | Participant public keys | Gather the configured roster through signed QR/link/paste responses. No provider is required. |
| Nexus atomic genesis | Encrypted shares | Generate the Nexus root/DEK only after the roster is complete, split it with SLIP-0039, encrypt one share per participant, then create the empty vault atomically. |
| Nexus open | Quorum contributions | Do not open the vault unless at least `T` distinct participant contributions reconstruct the root in Rust/WASM. |
| Import | Detected vault type | Fetch from a provider, then route Simple to its unlock/enrollment path or Nexus to quorum access. Provider login never opens Nexus. |
| Unlocked provider management | Sync provider | Add/remove post-genesis backup replicas for the active vault. |

See [nexus-genesis.md](nexus-genesis.md) for the complete two-round ceremony and
security invariants.

## Defaults and Persistence

Existing vault YAML with no `architecture:` field migrates in memory to:

```yaml
architecture:
  device_mode: standard
  vault_type: simple
```

The default may be omitted on write to keep legacy Simple vault YAML compact.
Non-default vault architecture metadata is persisted as a top-level
`architecture:` field in projection YAML and mirrored through WASM session
state. Vault type is immutable once a vault has a `store_id`; changing Simple
to Nexus or Nexus to Simple would reinterpret key-access records and must fail.

Legacy `replication_type` values remain readable but do not define new-vault
behavior. Default personal replication is omitted from new architecture
serialization, and vault creation does not ask for a replication mode.

Device-local High security material never belongs in vault YAML, provider
snapshots, event logs, app logs, or onboarding payloads. The local record is the
`passkey-wrapped-local` `device_identity_wrapped` IndexedDB value.

## Simple Lifecycle

Simple creation generates an empty vault locally and creates the normal
device-key envelope for the initiating device. The vault is immediately
openable on that device. Sync providers are optional and can be connected later
as backup/replica targets.

Importing a Simple vault retrieves encrypted data first, then uses an existing
device envelope, password recovery, or explicit enrollment path. Provider
credentials grant storage access only.

## Nexus Lifecycle

Nexus setup is pre-genesis state. It gathers all configured participant public
keys before generating the Nexus root or creating the vault. Genesis then
issues the complete encrypted SLIP-0039 share set atomically. The initiator has
no permanent threshold bypass and Nexus never writes a per-device full-key
envelope.

Password unlock is forbidden as the sole unlock path. Session hydrate from
projection YAML must fail closed and never resolve a full-key auth envelope.
Possession of the local cache or sync-provider credentials is insufficient.

An issued share set must be complete, use unique participant/share indexes, and
match the persisted `T-of-N` policy. Partial, malformed-prefix, stale-generation,
or mixed share sets fail closed. No Nexus vault session exists until actual
share records exist and at least `T` participant contributions reconstruct the
root. Gating only secret creation is insufficient.

After genesis, browser unlock is a signed, encrypted, session-bound ceremony:
each participating device opens its own protected local share inside Rust and
returns an opaque contribution encrypted to the requester. The requester
combines at least `T` distinct verified contributions inside Rust/WASM. Peer
`DeviceIdentity` secrets and plaintext shares never cross browsers, and raw
SLIP-0039 mnemonics never cross the WASM boundary.

Nexus uses a Nook-owned current-format extendable (`ext=1`), single-group
SLIP-0039 implementation with the user-selected `T-of-N` policy. One random
32-byte Nexus root derives `secrets_key` and `members_key` through
domain-separated HKDF-SHA256. Official extendable 256-bit vectors cover the
codec. This is distinct from the fixed-policy recovery flow in
[slip39-recovery.md](../product-specs/slip39-recovery.md).

Generic revocation/key rotation cannot leave the new epoch behind old shares or
write a full current-device envelope. Nexus participant replacement therefore
requires atomic roster replacement plus share rotation.

## Provider Capabilities

Provider capability affects only storage setup and transport. Examples include
whether a provider can use app-private storage, grant a shared folder, or bind
a connection to an external account identity. Unsupported provider operations
must fail closed in Rust, but they do not create a `personal` or `shared` vault
mode.

The currently implemented Google Drive shared-folder grant remains a provider
feature:

1. the owner creates a folder and grants the joiner's external identity;
2. the connection records the folder target without embedding owner tokens;
3. the joiner uses its own OAuth account to access the same encrypted replica.

This provider-account flow must not be used as Nexus membership or quorum.

## Web Boundary

Svelte may render vault type, Nexus policy, ceremony progress, and provider
choices, but it must call Rust/WASM for policy validation, participant
verification, share issuance, quorum access, and provider capability. Do not
recreate the state machine or threshold rules in TypeScript.

## Implemented Boundaries

- Nexus policy and ceremony transitions are Rust-owned and limited to
  `2 <= T <= N <= 16`.
- Finalization is one-shot and atomic: it emits the complete encrypted member
  roster, encrypted share set, participant delivery catalog, and event-log
  operations together; it never emits a full-key device envelope.
- Provider-free Round 2 delivery entries are signed and bound to the exact
  Round 1 session, store, policy, recipient identity, and share.
- Event-only projection retains the complete public Nexus roster and rebuilds
  canonical encrypted member rows after quorum unlock.
- Nexus unlock requests and responses are signed, encrypted, and session-bound;
  duplicate participants/share indexes and mismatched bindings fail closed.
- WASM exposes typed JSON/status boundaries while Svelte renders progress; raw
  roots, vault keys, opened shares, and mnemonic text remain in Rust.
