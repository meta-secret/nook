# Authenticator Items

## Overview

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

Setup-key and QR enrollment and service-provided backup-code capture require explicit
Pilot consent and a confirmation flow. They must never run as silent page
scraping. [Browser enrollment capture](#browser-enrollment-capture) defines
them.

## Browser enrollment capture

### Eligibility

- **Add 2FA from this page** appears only as a user-initiated Pilot action on
  authenticator setup pages.
- A page qualifies when visible QR media sits beside instructions to scan it
  with an authenticator app.
- A page with no QR media qualifies when nearby instructions ask the user to
  enter a setup key in an authenticator app.
- Square image/canvas geometry and QR labels alone are insufficient.
- Landing-page artwork, app-download QR codes, sign-in QR codes, payment QR
  codes, and generic security marketing do not qualify as authenticator setup.
- Content scripts report only bounded instruction copy before consent:
  dialog label and description targets, headings, and paragraphs.
  Text in a `div` or `span` after the QR media is excluded, so a setup key
  shown below the code never enters the copy.
- `nook-companion-core` owns the portable eligibility classification exposed
  through `nook-companion-wasm`.
  Its additive classification is ephemeral.
  It introduces no persisted schema change or storage migration.
- Eligibility detection never decodes a QR payload and never reads a setup key.

### Candidates after the trusted click

- Nothing below runs before the trusted **Add 2FA from this page** click.
- The content script rasterizes each visible QR image, canvas, or inline SVG
  into a bounded RGBA picture, at most 8 pictures of 512 px per edge.
- The extension-origin offscreen document decodes those pictures with the
  bundled ZXing reader.
  It is the only QR decoder.
  There is no `BarcodeDetector` path.
- The content script also gathers visible setup-key text candidates from the
  same setup scopes.
  It reads at most 16 texts of 256 bytes, skips buttons and links, and never
  judges whether a text is a key.
- Rust/WASM resolves the decoded QR payloads and the texts into candidates.
  It drops everything else without echoing or counting it.
- Only `otpauth://totp/...` payloads that the existing parser accepts become QR
  candidates.
- A text becomes a setup-key candidate when Rust finds it plausible:
  - It is single-case Base32 (`A`-`Z` or `a`-`z`, `2`-`7`) with an optional
    short label prefix such as `Setup key:` and optional trailing `=` padding.
  - It is one token or at least three uniform groups of 4-8 characters.
  - It has a digit `2`-`7` or at least 26 letters as key evidence.
  - `TotpSecret` validation accepts it.
- Rust builds the setup-key enrollment with SHA-1, 6 digits, a 30-second
  period, and the page host as issuer.
- A QR candidate and a setup key with the same secret collapse to the QR
  candidate.
- More than one remaining candidate opens the picker.
  Each picker label shows the candidate source and ordinal, never a secret.
- The pictures, texts, and decoded payloads are cleared after resolution and
  are never logged.

### Preview and save

- The Pilot preview shows editable **Service** (required) and **Account**
  (optional) fields, plus the read-only protocol parameters.
- Rust validates both labels at save: trimmed, bounded, and free of control
  characters.
- The page origin is stored as the item's website URL.
- The shared secret never appears in the preview, URLs, logs, or durable
  browser storage outside the vault.
- Cancelling or closing the flow writes no vault event.
  It clears the URI, candidates, pixels, and labels from memory.
- **Save backup codes** is a separate consented action.
  Candidate codes are extracted only after approval, reviewed (edit, select,
  remove, or paste), then attached to a named authenticator through typed
  replace/merge policy in Rust/WASM.
  Ambiguous page text cannot be saved without choosing the target
  authenticator.

**Prohibited:** show **Add 2FA from this page** for a square landing-page image,
an image labeled “QR code,” or an app-download QR beside generic security text.
Likewise, decode a QR or read a setup key while only deciding eligibility.

**Required:** offer the action for visible QR media beside “Scan this QR code
with your authenticator app” or “Scan this QR code with Google Authenticator.”
Offer it for a page without QR media that says “Enter this setup key in your
authenticator app.” Decode the QR and read setup-key text only after the user
clicks the action.
