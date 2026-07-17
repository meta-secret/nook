# Authenticator Items

Add RFC 6238 TOTP authenticators as a first-class secure-item type.

## Product model

- An authenticator is a standalone vault item, not a field that only exists on
  website logins. This supports websites, native apps, CLIs, email accounts,
  and other services equally.
- Non-secret metadata is an issuer/service name and optional account label.
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

- The create/edit form exposes only service, account, and setup key/URI.
- The vault list exposes only issuer, account, and the recovery-code count for
  backward-compatible items that already contain recovery codes.
- Expanding an item requests the current code from Rust/WASM. The browser owns
  only the one-second display timer and refresh request.
- The shared secret and legacy recovery-code values stay masked until explicit
  reveal.
- No authenticator shared secret, recovery code, or generated TOTP value may be
  logged.

## Future

Browser-extension matching and login-time OTP autofill remain tracked in
GitHub issue #239. Origin matching must not make standalone authenticators
website-only.
