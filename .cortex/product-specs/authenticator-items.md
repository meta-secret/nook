# Authenticator Items

Add RFC 6238 TOTP authenticators as a first-class secure-item type.

## Product model

- An authenticator is a standalone vault item, not a field that only exists on
  website logins. This supports websites, native apps, CLIs, email accounts,
  and other services equally.
- Non-secret metadata is an issuer/service name, optional account label, and
  optional website URL used for vault list clustering with matching logins.
- When the website URL is empty at create/import time, Nook may infer
  `https://{host}` from a domain-like issuer or a bundled popular-issuer map
  (`nook-core/data/authenticator_issuer_hosts.json`, e.g. `OpenAI` →
  `openai.com`). Existing vault items without a URL keep working; clustering
  still uses the same inference for display keys.
- Encrypted payload data contains the Base32 shared secret and TOTP parameters.
  Existing items may also contain service-issued recovery codes for backward
  compatibility, but recovery codes are not part of TOTP setup.
- Generated TOTP values are ephemeral. They are derived in Rust from the
  encrypted shared secret and current Unix time; they are never stored in the
  vault event log.

## Supported input

- Manual Base32 shared secrets.
- `otpauth://totp/...` URIs used by Google Authenticator-compatible services.
- Manual setup keys use the interoperable SHA-1, 6-digit, 30-second defaults.
- `otpauth://` URIs may specify SHA-1, SHA-256, or SHA-512; 6–8 digits; and a
  15–300 second period. Rust parses those parameters without exposing protocol
  controls in the ordinary form.

## UI and security

- The create/edit form exposes service, account, optional website URL, and setup
  key/URI.
- The vault list exposes issuer, account, optional website URL, and the
  recovery-code count for backward-compatible items that already contain
  recovery codes.
- Expanding an item requests the current code from Rust/WASM. The browser owns
  only the one-second display timer and refresh request.
- The shared secret and legacy recovery-code values stay masked until explicit
  reveal.
- No authenticator shared secret, recovery code, or generated TOTP value may be
  logged.

## Browser extension use

- The content script recognizes standard `autocomplete="one-time-code"` fields
  and conservative OTP/TOTP/2FA/MFA name/id conventions.
- A user action asks the unlocked extension session for safe authenticator
  metadata. Optional website URLs improve vault clustering with logins, but
  until fill treats that association as trusted origin matching, Nook still
  requires the user to choose the displayed service/account before deriving
  and releasing a code.
- Rust/WASM decrypts the selected item and derives the current code only after
  that choice. The short-lived value crosses only the local extension fill
  path, is cleared from the response object, and is never persisted or logged.
- When the vault has no authenticator items, the widget says that no 2FA code is
  saved and offers to open Simple Vault to add one.

QR enrollment and service-provided backup-code capture require a separate,
explicit settings-page consent and confirmation flow. They must never run as
silent page scraping.

## Browser enrollment capture

- **Add 2FA from this page** appears only as a user-initiated Pilot action on
  pages that look like authenticator setup. Nook discovers visible QR
  images/canvases and decodes them locally only after that trusted click.
- Only bounded `otpauth://totp/...` payloads are accepted. Rust/WASM validates
  and canonicalizes the URI; the Pilot preview shows service, account, page
  origin, and protocol parameters before save. The shared secret never appears
  in the preview, URLs, logs, or durable browser storage.
- Cancelling or closing the flow writes no vault event and clears any decoded
  URI from memory.
- **Save backup codes** is a separate consented action. Candidate codes are
  extracted only after approval, reviewed (edit/select/remove or paste), then
  attached to a named authenticator through typed replace/merge policy in
  Rust/WASM. Ambiguous page text cannot be saved without choosing the target
  authenticator.
