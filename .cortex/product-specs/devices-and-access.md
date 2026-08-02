# Devices & access

## Product statement

Nook exposes one **Devices & access** dashboard per vault-application origin.
It is available before a vault exists, while a vault is locked, and while a
vault is open. It explains access authority; it is not a universal passkey
manager and does not merge the origin-isolated Simple or Sentinel identities.
The browser extension remains a Simple Vault companion, not a third vault
application: its separate identity is managed through extension setup and
connection flows rather than this dashboard.

## Access model

1. A WebAuthn passkey or local PIN/passphrase protects one browser-local age
   device identity.
2. The device identity may be enrolled in zero, one, or many independent
   vaults. Each vault still owns independent vault keys and authorization rows.
3. A vault backup password opens only its owning vault. It does not unlock or
   replace the browser device identity.
4. Storage and sync providers replicate ciphertext. They do not grant vault
   decryption by themselves.

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
