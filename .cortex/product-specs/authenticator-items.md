# Authenticator Items

Add RFC 6238 TOTP authenticators as a first-class secure-item type.

## Product model

- An authenticator is a standalone vault item, not a field that only exists on
  website logins. This supports websites, native apps, CLIs, email accounts,
  and other services equally.
- Non-secret metadata is an issuer/service name and optional account label.
- Encrypted payload data contains the Base32 shared secret, TOTP algorithm,
  digit count, period, and optional one-use backup codes.
- Generated TOTP values are ephemeral. They are derived in Rust from the
  encrypted shared secret and current Unix time; they are never stored in the
  vault event log.

## Supported input

- Manual Base32 shared secrets.
- `otpauth://totp/...` URIs used by Google Authenticator-compatible services.
- SHA-1, SHA-256, and SHA-512; 6–8 digits; 15–300 second periods.
- Backup codes entered one per line. Blank lines and duplicates are removed in
  Rust before encryption.

## UI and security

- The vault list exposes only issuer, account, and backup-code count.
- Expanding an item requests the current code from Rust/WASM. The browser owns
  only the one-second display timer and refresh request.
- The shared secret and backup-code values stay masked until explicit reveal.
- No authenticator shared secret, backup code, or generated TOTP value may be
  logged.

## Future

Browser-extension matching and login-time OTP autofill remain tracked in
GitHub issue #239. Origin matching must not make standalone authenticators
website-only.
