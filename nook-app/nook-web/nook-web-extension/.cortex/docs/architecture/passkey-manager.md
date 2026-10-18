# Website Passkey Manager

## Overview

**Status:** Implemented for Chromium and Simple Vault.

**Related:** [browser-extension.md](../spec/browser-extension.md),
[password-manager.md](../../../../../.cortex/docs/spec/password-manager.md), and
[vault-event-log.md](../../../../../nook-platform/nook-event-log/.cortex/docs/architecture/vault-event-log.md).

Nook can act as a software WebAuthn authenticator for websites. The Chromium
extension intercepts explicit `navigator.credentials.create()` and `get()`
requests, offers an approved Simple Vault after user consent, and returns a
standard credential response. Nook never hands an intercepted request to the
browser on its own: the browser runs only when the person chooses it on the
Nook card. Conditional mediation is left to the browser.

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

- **Registration input and RP validation:**
  - Accept only canonical bounded base64url values and ES256 (`-7`).
  - Require the RP ID to be `localhost` or a registrable DNS name.
  - Reject a public suffix.
  - Require the RP ID to equal the origin host or be its domain suffix.
  - Require HTTPS for production origins. Loopback development may use
    `http://localhost`.
  - Mark credentials discoverable and backup-eligible because their encrypted
    key material is designed to replicate through Nook.
  - Register even when the site lists the account's existing passkeys in
    `excludeCredentials`. A vault may keep several passkeys for one account,
    so adding another never ends in an error.
  - Report Nook's own authenticator GUID (AAGUID),
    `7cd62a4c-b484-4f37-a4e2-3ac3b0c33c9e`, in the attested credential data.
    An all-zero AAGUID leaves a site to guess the provider from the browser,
    so Google labelled Nook passkeys "iCloud Keychain". A site names the
    provider once the public passkey-provider list includes this AAGUID.
- **Assertion construction and session flags:**
  - Hash the RP ID into authenticator data.
  - Sign `authenticatorData || SHA-256(clientDataJSON)` with the stored P-256
    private key.
  - Use the user-presence flag for the explicit extension consent action.
  - Set user verification when the website requires or prefers it. `preferred`
    is the `WebAuthn` default, and accounts such as Google reject passkey
    sign-in without it. Only `discouraged` leaves the flag clear. Extension
    sessions unlock only with a passkey or PIN, so an unlocked session vouches
    for the user. Rust owns this decision.
  - Expire that session after 15 minutes. A locked session shows the card's
    locked notice; the browser runs only on request.
- **Commit ordering and provider failure:**
  - Commit registration as `SecretCreated` before returning its response.
  - Commit each incremented assertion counter as `SecretReplaced` before
    returning its response.
  - Do not invalidate a locally committed ceremony after a remote-provider
    failure. The immutable local event remains available to the next provider
    flush.
- **Concurrent revisions:**
  - Accept multiple encrypted revisions for one WebAuthn credential only when
    all credential and key material is identical.
  - Resume from the highest observed counter.
  - Append one replacement plus tombstones for stale revisions.
  - Require explicit account selection for different discoverable credentials.

## Threat model

### Required actions

- **Host page replays or alters a ceremony request**
  - **Required behavior:** Bind worker authorization to the exact sender origin, RP, tab/frame, request id, and one pending request; repeat all security validation in Rust. Public response objects do not authorize vault operations.
- **Host page requests another RP**
  - **Required behavior:** Validate the exact sender origin in the service worker and repeat RP/origin/public-suffix validation in Rust.
- **Revoked extension keeps signing**
  - **Required behavior:** Rebuild the local event graph and require current device approval/key-envelope access before each operation.
- **Private key leaks through UI or logs**
  - **Required behavior:** Keep key parsing/signing in Rust, redact `Debug`, zeroize decrypted payloads, and expose no key getter.
- **Duplicate/replayed ceremony**
  - **Required behavior:**
    - Deduplicate pending tab/frame/request tuples.
    - Use fresh browser challenges and random credential ids.
    - Persist counters atomically.
- **Malformed or oversized page input**
  - **Required behavior:** Reject over 64 KiB in the isolated bridge and runtime validator, then apply typed bounded parsing in Rust.
- **Extension is locked or unavailable**
  - **Required behavior:** Show the Nook card with the reason. Invoke the
    browser's original WebAuthn method only when the person chooses **Use
    another passkey**.
- **Nook ceremony fails after selection**
  - **Required behavior:** Return a generic `NotAllowedError`.
- **Spoofed Pilot HUD proposes Create/Use passkey**
  - **Required behavior:** Treat HUD approval only as permission to activate a site passkey control. Ceremony consent, RP/origin binding, and private-key ops stay in the existing WebAuthn intercept (`webauthn-content` / Rust).
- **Pilot proposal policy**
  - **Required behavior:** Return non-secret eligibility only (`none` / `use-passkey` / `create-passkey`). Create/assert remain on the consented ceremony path.
- **Locked session advertises vault matches**
  - **Required behavior:** Matching account counts are attached only from an unlocked, granted Simple Vault projection; locked/unavailable sessions contribute `0` and never expose metadata.
- **Pilot auto-submits or silently creates**
  - **Required behavior:** Default remains explicit user action; Take over is always available.

### Prohibited actions

- **Extension is locked or unavailable:** Do not expose account metadata.
- **Nook ceremony fails after selection:** Do not leak vault, key, or provider details to the website.
- **Pilot proposal mints challenges or signs:** Forbidden.
- **Locked session advertises vault matches:** Locked or unavailable sessions never expose metadata.
- **Pilot auto-submits or silently creates:** No permanent site autopilot grant.

## Consent card

The isolated content script shows one Nook-owned card per ceremony at the
Pilot's top-right anchor, in the shared in-page keytag style. The card does not
dim or block the page. The Pilot hides while the card is open because they
share that corner.

- **Registration:** the title names the site. The card shows the account the
  site is registering and a vault choice with the first approved vault
  preselected. **Save passkey** is the consent.
- **Assertion:** one row per matching account with its vault. Choosing a row is
  the consent.
- **Nothing to offer:** when no vault passkey is one the site asked for, Nook is
  locked, no vault keeps passkeys, or the lookup failed, the card says which and
  offers **Use another passkey**. It lists no account.
- **Progress and result:** after consent the card shows Saving or Signing in.
  A saved passkey shows its vault for three seconds. A failure stays until the
  user closes it. The website still receives only `NotAllowedError`.
- **Decline:** Close or Escape returns `NotAllowedError`, like cancelling the
  browser dialog. **Use browser or security key** hands the request to the
  browser.

## Pilot proposals

Nook Pilot may propose **Use passkey** when an unlocked vault has confident RP
matches, or **Create passkey** when the page exposes a passkey control and no
matches exist. Proposals require human approval in the Pilot gate, then only
activate the site's own WebAuthn entry point so the existing consent chooser
runs. Automatic submit/sign-up remains out of scope.

The extension prompt is visually Nook-owned but a website can imitate any
in-page UI. It therefore never asks for recovery material, provider tokens, or
vault passwords. Device authorization remains in the extension-owned side panel
or authentication tab and in the offscreen session.
