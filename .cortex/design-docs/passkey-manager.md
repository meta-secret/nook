# Website Passkey Manager

**Status:** Implemented for Chromium and Simple Vault.

**Related:** [browser-extension.md](../product-specs/browser-extension.md),
[password-manager.md](../product-specs/password-manager.md), and
[vault-event-log.md](vault-event-log.md).

Nook can act as a software WebAuthn authenticator for websites. The Chromium
extension intercepts explicit `navigator.credentials.create()` and `get()`
requests, offers an approved Simple Vault after user consent, and returns a
standard credential response. The browser remains available through an
explicit fallback action. Conditional mediation is left to the browser.

## Trust and ownership boundaries

- Rust owns request validation, RP/origin matching, ES256 key generation,
  client data, authenticator data, CBOR attestation, signatures, credential
  lookup, and signature-counter updates.
- WASM decrypts only passkey records and exposes typed metadata or public
  ceremony responses. It never exposes a private key.
- The extension's isolated content script owns the consent surface and typed
  transport. The main-world bridge only adapts browser WebAuthn options and
  responses.
- Only an unlocked, separately approved extension device can open a Simple
  Vault projection. The live event graph is checked for active device access
  before every lookup or ceremony.
- Passkeys are ordinary encrypted per-record vault payloads and are replicated
  by the immutable event log. Provider credentials remain device-sealed.

## Ceremony rules

Registration accepts only canonical bounded base64url values and ES256 (`-7`).
The RP ID must be `localhost` or a registrable DNS name, must not be a public
suffix, and must equal the origin host or be its domain suffix. Production
origins require HTTPS; loopback development may use `http://localhost`.
Credentials are discoverable and backup-eligible because their encrypted key
material is designed to replicate through Nook.

Assertions hash the RP ID into authenticator data and sign
`authenticatorData || SHA-256(clientDataJSON)` with the stored P-256 private
key. The user-presence flag represents the explicit extension consent action.
The user-verification flag is set only when the website requested verification
and the extension vault is in its passkey/PIN-authorized unlocked session. The
session expires after 15 minutes; a locked session falls back to the browser.

Registration is committed as `SecretCreated` before a response is returned.
Each assertion commits the incremented counter as `SecretReplaced` before its
response. A remote-provider failure does not invalidate an already committed
local WebAuthn ceremony; the immutable local event remains available to the
next provider flush.

Concurrent devices can produce multiple encrypted revisions for one WebAuthn
credential. Lookup accepts those revisions only when all credential and key
material is identical, resumes from the highest observed counter, and appends
one replacement plus tombstones for stale revisions. Different discoverable
credentials still require explicit account selection.

## Threat model

| Threat | Required behavior |
|---|---|
| Host page replays or alters a ceremony request | Bind worker authorization to the exact sender origin, RP, tab/frame, request id, and one pending request; repeat all security validation in Rust. Public response objects do not authorize vault operations. |
| Host page requests another RP | Validate the exact sender origin in the service worker and repeat RP/origin/public-suffix validation in Rust. |
| Revoked extension keeps signing | Rebuild the local event graph and require current device approval/key-envelope access before each operation. |
| Private key leaks through UI or logs | Keep key parsing/signing in Rust, redact `Debug`, zeroize decrypted payloads, and expose no key getter. |
| Duplicate/replayed ceremony | Deduplicate pending tab/frame/request tuples; use fresh browser challenges and random credential ids; persist counters atomically. |
| Malformed or oversized page input | Reject over 64 KiB in the isolated bridge and runtime validator, then apply typed bounded parsing in Rust. |
| Extension is locked or unavailable | Do not expose account metadata; invoke the browser's original WebAuthn method. |
| Nook ceremony fails after selection | Return a generic `NotAllowedError`; do not leak vault, key, or provider details to the website. |
| Spoofed Pilot HUD proposes Create/Use passkey | Treat HUD approval only as permission to activate a site passkey control. Ceremony consent, RP/origin binding, and private-key ops stay in the existing WebAuthn intercept (`webauthn-content` / Rust). |
| Pilot proposal mints challenges or signs | Forbidden. Proposal policy returns non-secret eligibility only (`none` / `use-passkey` / `create-passkey`). Create/assert remain on the consented ceremony path. |
| Locked session advertises vault matches | Matching account counts are attached only from an unlocked, granted Simple Vault projection; locked/unavailable sessions contribute `0` and never expose metadata. |
| Pilot auto-submits or silently creates | Default remains explicit user action. No permanent site autopilot grant; Take over always available. |

## Pilot proposals

Nook Pilot may propose **Use passkey** when an unlocked vault has confident RP
matches, or **Create passkey** when the page exposes a passkey control and no
matches exist. Proposals require human approval in the Pilot gate, then only
activate the site's own WebAuthn entry point so the existing consent chooser
runs. Automatic submit/sign-up remains out of scope.

The extension prompt is visually Nook-owned but a website can imitate any
in-page UI. It therefore never asks for recovery material, provider tokens, or
vault passwords. Device authorization remains in the extension-owned popup and
offscreen session.
