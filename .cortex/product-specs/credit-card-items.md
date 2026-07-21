# Credit Card Items

Add payment cards as a first-class vault item type alongside login, API key,
secure note, seed phrase, passkey, and authenticator.

## Goals

- Store cardholder details needed for checkout (number, expiry, optional CVV)
  as an encrypted typed secret.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload,
  age-encrypted value, list/detail UI with reveal and copy.
- Keep full PAN and CVV out of list projections and logs; show only title,
  cardholder, last four digits, and expiry in the vault list.

## Product model

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Display name (e.g. "Personal Visa") |
| `cardholderName` | no | Name on card |
| `number` | yes | Digits only after normalize; Luhn-validated; 12–19 digits |
| `expirationMonth` | with year | `01`–`12` when set |
| `expirationYear` | with month | Four-digit year when set |
| `cvv` | no | 3–4 digits when set |
| `notes` | no | Free-form notes |

Expiry month and year are either both empty or both present.

## UI and security

- Type picker entry creates a credit-card form (title, cardholder, number,
  expiry, CVV, notes).
- List rows show title, masked last four (`•••• 4242`), and expiry when present.
- Expanding an item decrypts the full record. Number and CVV stay masked until
  explicit reveal. Copy actions cover number, CVV, expiry, and cardholder.
- Full card number and CVV must never be logged.

## Import

Bitwarden (`type: 3`), 1Password Credit Card (`categoryUuid: 002`), and Proton
Pass (`type: creditCard`) map into this type when the export carries a usable
card number. Previously these items were counted as skipped unsupported.

## Out of scope (for now)

- Browser autofill of payment forms
- Card brand detection UI (Visa/Mastercard/…) as a stored field
- Billing address as structured fields (use notes if needed)
