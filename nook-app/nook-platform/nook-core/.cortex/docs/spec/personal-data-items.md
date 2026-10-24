# Personal Data Items

## Overview

Personal data is a vault category beside Secrets. It holds the details a user
types into forms: who they are, where they live, their documents, and how they
pay. Rust owns every model, validation rule, mask, and category assignment.
Web code renders the typed WASM projections.

## Category

`nook-auth2::SecretCategory` has two members, `Secrets` and `PersonalData`.
`SecretType::category()` assigns every type through an exhaustive match.

- **Personal data**
  - Person (`person`)
  - Address (`address`)
  - Identity document (`identity-document`)
  - Bank account (`bank-account`)
  - Card (`credit-card`), specified in [credit card items](credit-card-items.md)
- **Secrets**
  - Login, authenticator, API key, seed phrase, secure note, file attachment,
    and passkey.

`SecretTypeFilter::Category` selects one category. The WASM
`NookSecretTypeFilter` adds `Secrets`, `PersonalData`, and one entry per new
type. `secret_type_category` exposes the assignment to web code.

The vault page opens on **Secrets** and switches to **Personal data** through
a section switch. Each section has its own type filters and its own add picker.
Personal data records never appear in the Secrets list or its counts.

## Product model

Payloads are `camelCase` YAML with unknown fields rejected. Every text field is
trimmed. Embedded control characters fail validation. Optional fields store
the empty string when absent. Dates are strict ISO `YYYY-MM-DD` values that
exist in the Gregorian calendar.

- **Person**
  - `givenName`, `middleName`, `familyName`: at least one of given or family
    name is required.
  - `birthDate`: optional date.
  - `email`: optional `local@domain.tld` shape without whitespace.
  - `phone`: optional; digits plus `+ ( ) - .` and spaces, with at least one
    digit.
- **Address**
  - `label`: optional, such as `Home`.
  - `addressLine1`: required.
  - `addressLine2`, `city`, `region`, `postalCode`: optional.
  - `country`: optional name or code, stored as typed.
- **Identity document**
  - `kind`: `passport`, `national-id`, or `drivers-license`.
  - `number`: required.
  - `issuingCountry`, `nameAsPrinted`: optional.
  - `issueDate`, `expiryDate`: optional dates; expiry is never before issue.
- **Bank account**
  - `accountHolder`, `bankName`: optional.
  - `accountNumber`: required. Whitespace is removed and letters are
    uppercased.
    - An IBAN-shaped value has two letters, two check digits, and
      alphanumerics, with 15–34 characters in total. It must pass the ISO 7064
      MOD 97-10 checksum.
    - Any other value is a domestic number of alphanumerics and hyphens.
  - `routingCode`: optional routing, sort, or BIC code, stored as uppercase
    alphanumerics without spaces or hyphens.

Failures are typed `ValidationError` variants with translated
`errors.validation.*` messages. Decrypted payloads pass the same
normalization, so an invalid stored record fails closed.

## Masking

Identity-document and bank-account numbers share the card masking rule. List
rows and the default detail show `••••` plus a short tail. The tail has at
most four characters and never more than half of the number. A short number
therefore never appears in full.

## List and detail security

List projections carry only safe metadata.

- **Person:** full name and email.
- **Address:** label, first line, city, and country.
- **Identity document:** kind, name as printed, masked tail, and expiry date.
- **Bank account:** bank name, account holder, and masked tail.

Postal codes, birth dates, issue dates, routing codes, and full numbers stay
out of list rows and search. These types are not site-bound. Website search
never offers them for a page.

`NookSecretRecord.personalData` returns a `PersonalDataView` tagged by `kind`
for one explicitly decrypted record. It carries every field plus the masked
number. The view is zeroized after it crosses the WASM boundary. Cards keep
their own record getters. Other types fail with `PersonalDataViewUnavailable`.

The web detail keeps each field sealed until reveal. Numbers show the Rust
mask until then. `Debug` output names only the record type or document kind.
Every payload zeroizes its plaintext.

## Compatibility decision

Nook has no released versions. The new types and the changed filter enums use
the new format only. They have no migrations, legacy readers, compatibility
branches, aliases, or version gates. Importers do not produce the new types.

## Executable scenarios

- Rust tests in `nook-core/src/secrets/personal_data/` own normalization,
  required fields, calendar dates, email and phone shapes, document date
  order, IBAN checksums, masking, redacted `Debug`, and zeroization.
- Rust tests in `secret_view/personal_data_*` cover typed forms, decrypt-path
  revalidation, safe list items, and the explicit detail view.
- `nook-auth2` tests cover wire names and category assignment. Fingerprint and
  `vault_session` tests cover per-type identities and category filtering.
- `nook-wasm` tests prove that list items stay masked while the detail view
  reveals fields, and that cards have no personal view.
- Web unit tests cover section switching, section filters, the add picker,
  typed form DTOs, Rust validation keys, edit pre-fill, and sealed detail.
- Existing card and import Playwright specs open the Personal data section
  before checking cards.

## Out of scope (for now)

- Sign-up detection and registration drafts.
- Linking a login to its personal data.
- Browser fill of identity documents and bank accounts. Person, address, and
  card fill follows the
  [personal field autofill](../../../../nook-companion-core/.cortex/docs/spec/personal-field-autofill.md)
  specification.
