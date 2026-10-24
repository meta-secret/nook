# Credit Card Items

## Overview

Add payment cards as a first-class vault item type. Cards belong to the
[Personal data](personal-data-items.md) category, not to Secrets.

## Goals

- Store cardholder details needed for checkout (number, expiry, optional CVV)
  as an encrypted typed secret.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload,
  age-encrypted value, list/detail UI with reveal and copy.
- Keep full PAN and CVV out of list projections and logs; show only title,
  cardholder, last four digits, and expiry in the vault list.

## Product model

- **`title`**
  - Required display name such as `Personal Visa`.
- **`cardholderName`**
  - Optional name on the card.
- **`number`**
  - Required.
  - Normalized to 12–19 digits.
  - Luhn-validated.
- **`expirationMonth` and `expirationYear`**
  - Both are empty or both are present.
  - Month is `01`–`12`.
  - Year is four digits.
- **`cvv`**
  - Optional.
  - Contains 3–4 digits when present.
- **`notes`**
  - Optional free-form text.

Expiry month and year are either both empty or both present.

## UI and security

- The Personal data section's add picker creates a credit-card form (title,
  cardholder, number, expiry, CVV, notes).
- List rows show title, masked last four (`•••• 4242`), and expiry when present.
- Expanding an item decrypts the full record. Number and CVV stay masked until
  explicit reveal. Copy actions cover number, CVV, expiry, and cardholder.
- Full card number and CVV must never be logged.

## Browser autofill

The extension fills payment forms through the `Card` group of
[personal field autofill](../../../../nook-companion-core/.cortex/docs/spec/personal-field-autofill.md).
Fields are classified by the `cc-*` autocomplete tokens, with the
identity-text fallback. The user selects one card. Only the planned
cardholder, number, expiry, and CVV values are revealed for that fill.

## Import

Bitwarden (`type: 3`), 1Password Credit Card (`categoryUuid: 002`), Proton Pass
(`type: creditCard`), Dashlane `credit_card` payment rows, and LastPass
`Credit Card` secure notes map into this type when the export carries a usable
card number. Unsupported payment rows remain counted and skipped. Other
personal-data imports are specified in
[personal data items](personal-data-items.md#import).

## Executable scenarios

- Rust tests own Luhn validation, expiry and CVV bounds, safe list projection,
  and redacted debug output.
- WASM tests prove that list projections expose only safe metadata while the
  explicitly decrypted detail record exposes the full fields.
- Playwright covers invalid submission, masking before reveal, explicit
  reveal, copy actions, edit and reload persistence, deletion, and absence of
  full card values from application logs.
- Import scenarios verify supported provider mappings and safe list rendering.

## Out of scope (for now)

- Card brand detection UI (Visa/Mastercard/…) as a stored field
- Billing address as structured fields (use notes if needed)
