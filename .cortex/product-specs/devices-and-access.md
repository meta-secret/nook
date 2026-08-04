# Devices & access

## Product statement

**Devices & access** is Nook's identity-management surface. An identity is a
virtual account analogous to an account or user profile. One person may use
multiple personal or collective identities, and each identity may exist with
zero or more keys. The surface is available before a vault exists, while every
vault is locked, and while a vault is open. It explains identity, physical
device, device-key, passkey, provider, onboarding, and downstream vault-grant
relationships; it is not a universal passkey manager.
The browser extension remains a Simple Vault companion, not a third vault
application. Its installation-specific device key and relationship to a
selected virtual identity are managed through extension setup and connection
flows rather than this dashboard.

The current implementation is browser-device-centered. The target architecture
expands the same permanent surface to personal and collective identities
without making a vault the parent of those identities. See
[identity-vault-architecture.md](../design-docs/identity-vault-architecture.md).

## Identity and access model

1. A person owns or participates in zero or more virtual identities.
2. An identity contains zero or more registered device public keys and passkey
   credential records. A zero-key identity is a valid but unusable setup state.
3. A physical device, its Nook/browser installation, and a device key are
   separate. One physical device may host several installations; each
   installation generates fresh random private device keys locally and
   publishes only their public keys to the selected identity record.
4. A WebAuthn passkey or local PIN/passphrase protects a local device key. A
   passkey may be synced by its provider and therefore must not be assigned a
   fabricated physical-device location.
5. Identity records use zero or more sync-provider mounts to exchange encrypted
   membership, public-key, passkey-record, and revocation events.
6. An identity may receive grants to zero, one, or many independent vaults.
   Each vault owns an independent DEK and one vault-owned grant per authorized
   identity. The grant contains a recipient envelope for every concrete,
   authorized installation-specific X25519 device public key in that identity;
   an abstract identity key, policy, or provider mount is never the encryption
   recipient. Adding an identity device does not add vault access until an
   authorized vault actor refreshes the grant.
7. A vault backup password opens only its owning vault. It does not unlock or
   replace a virtual identity or local device key.
8. Storage and sync providers are neutral replication transports. Identity
   control logs and vault event logs may mount them independently; provider
   access never grants Nook identity membership or vault decryption by itself.
9. Passwords and other secret items are vault content, not identity state.

## Evidence and provenance

Dashboard facts must be distinguishable as:

- **verified by Nook** — a cryptographic device-key open succeeded;
- **reported by browser** — WebAuthn supplied attachment, transports,
  backup flags, AAGUID, or ceremony client metadata;
- **named by the user** — a reminder about where the user believes a passkey
  was saved;
- **last-known** — locally cached evidence from an earlier session; or
- **unknown** — unavailable, unsupported, or predating metadata collection.

WebAuthn cannot enumerate all credentials stored by external passkey managers,
reliably identify the provider selected in a ceremony, confirm that a provider
still retains a credential, or inventory credentials from another RP ID.
The dashboard must never imply those capabilities.

WebAuthn also cannot force an ordinary platform passkey to be local-only. The
authenticator chooses whether a credential is backup eligible. Nook records
`BE=0` as device-bound and `BE=1` as multi-device/sync-capable, but
`authenticatorAttachment`, discoverability, and `residentKey` are not locality
proof. A synced passkey is shown as provider-available, never as stored on one
physical device. See
[identity-vault-architecture.md](../design-docs/identity-vault-architecture.md#passkey-locality-and-synced-passkeys).

## Persistence boundary

Unlock-critical `device_id` and `device_identity_wrapped` records remain
unchanged. Descriptive dashboard metadata uses a separately versioned
`device_access_profile` record. Missing, corrupt, or future descriptive data
must not prevent device-key unlock. Resetting the browser device identity also
removes its descriptive access profile.

The dashboard may persist only non-secret metadata: safe fingerprints,
user-supplied labels, browser observations, timestamps, and verified
device-to-vault relationships. Private age keys, PRF output, PIN/passphrases,
vault keys, backup-password values, and plaintext vault contents are forbidden.

## Interaction requirements

The shipped dashboard currently presents a three-link device slice. It remains
a truthful view of the current browser, but it is not the complete target
identity model. The next identity-management design must also support:

- choosing among personal and collective identities before choosing a vault;
- showing that one person may use multiple identities;
- keeping physical devices, installation evidence, device keys, and passkeys
  as distinct facts and relationships rather than one overloaded “device
  identity” object;
- inspecting member-to-device-key relationships and identity-control history;
- onboarding, suspending, replacing, and revoking identity devices without
  requiring an open vault;
- showing identity-specific sync providers and the public keys present in the
  replicated identity record;
- inspecting identity-to-vault grants as many-to-many relationships;
- showing provider connections as separate mounts for identity control logs and
  vault event logs; and
- keeping vault passwords, items, DEK epochs, and event history in the vault
  surface rather than presenting them as identity properties.

Current dashboard requirements:

- The dashboard presents the access model as one three-link chain — what the
  person presents, the browser device key it unlocks, and the vaults it opens —
  and lets exactly one link be inspected at a time. Each link shows at most one
  identifier so the relationship stays readable instead of becoming a list of
  key ids.
- The chain claims access only where a device-key open actually succeeded. The
  vault link names verified vaults only, and while known vaults exist with none
  verified, the relation drops the access verb instead of implying reach.
- Each link's incoming relation is part of its accessible name, so the chain
  reads as a chain without seeing the drawn connectors.
- An unprepared browser has chosen neither a passkey nor a PIN, so its preview
  names the first link generically rather than promising either. A companion
  session's identity is attributed to the paired device, never to local browser
  storage.
- The login surface always offers **Devices & access**.
- A first-run suggestion may invite the user to review access before choosing a
  vault; **Don't show again** is a browser-local preference and never hides the
  dashboard entry point.
- An unprepared browser may start device protection from the dashboard.
- The authenticated app exposes **Access** as a primary navigation destination.
- The unlocked view may summarize current-vault enrolled devices and backup
  password labels, with links to the existing management controls.
- Technical identifiers use progressive disclosure and never show raw passkey
  credential bytes.
