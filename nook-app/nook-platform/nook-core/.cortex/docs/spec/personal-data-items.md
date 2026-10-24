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
  - International account (`international-account`)
  - US bank account (`domestic-account`)
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
- **International account**
  - `accountHolder`, `bankName`: optional.
  - `iban`: required. Whitespace is removed and letters are uppercased. The
    value needs the ISO 13616 shape: two letters, two check digits, then
    alphanumerics, with 15–34 characters in total. It must pass the ISO 7064
    MOD 97-10 checksum. No other account format is accepted.
  - `swiftBic`: optional ISO 9362 code of 8 or 11 characters, stored
    uppercase without whitespace. The first six characters are letters.
- **US bank account**
  - `accountHolder`, `bankName`: optional.
  - `accountNumber`: required; 4–17 digits.
  - `routingNumber`: required nine-digit ABA number whose 3-7-1 weighted
    digit sum is a multiple of ten.
  - Spaces and hyphens are stripped from both numbers.

Failures are typed `ValidationError` variants with translated
`errors.validation.*` messages. Decrypted payloads pass the same
normalization, so an invalid stored record fails closed.

## Masking

Identity-document numbers, IBANs, and US account numbers share the card
masking rule. List rows and the default detail show `••••` plus a short tail.
The tail has at most four characters and never more than half of the number.
A short number therefore never appears in full.

The SWIFT/BIC and the ABA routing number are public bank identifiers. They are
shown plain.

## List and detail security

List projections carry only safe metadata.

- **Person:** full name and email.
- **Address:** label, first line, city, and country.
- **Identity document:** kind, name as printed, masked tail, and expiry date.
- **International account:** bank name, account holder, masked IBAN tail, and
  SWIFT/BIC.
- **US bank account:** bank name, account holder, masked account tail, and
  routing number.

A bank row summary is the masked number followed by its bank code, such as
`•••• 5432 · NWBKGB2L`. Postal codes, birth dates, issue dates, and full
numbers stay out of list rows and search. These types are not site-bound.
Website search never offers them for a page.

`NookSecretRecord.personalData` returns a `PersonalDataView` tagged by `kind`
for one explicitly decrypted record. It carries every field plus the masked
number. The view is zeroized after it crosses the WASM boundary. Cards keep
their own record getters. Other types fail with `PersonalDataViewUnavailable`.

The web detail keeps each field sealed until reveal. Numbers show the Rust
mask until then. Forms conceal the IBAN and the US account number; SWIFT/BIC
and routing number are plain fields. `Debug` output names only the record
type or document kind. Every payload zeroizes its plaintext.

## Compatibility decision

Nook has no released versions. The new types and the changed filter enums use
the new format only. They have no migrations, legacy readers, compatibility
branches, aliases, or version gates. The earlier single `bank-account` type is
removed with its wire name and shape; nothing reads it.

## Import

Importers describe each source item as person, address, document, and bank
parts. Every present part is validated by its payload constructor.

- One composite source item may produce several records. A Bitwarden identity
  can yield a person, an address, a passport, and a driver's license.
- A person needs a given, middle, or family name. Contact details alone form
  no person.
- An address needs a street line, city, or postal code. A region or country
  alone forms no address.
- A document needs its number.
- A bank part with an IBAN becomes an international account. An account
  number with a routing number becomes a US bank account. Other bank values
  fit no type and are not imported.
- No field substitutes for another. A missing value stays empty instead of
  being derived from a neighbouring field.
- `Month,Day,Year` dates need a four-digit year.
- One invalid present part skips the whole source item with
  `InvalidPersonalData`. Values are never coerced, and the item never falls
  back to a secure note.
- An unsupported part does not stop the item's other parts from importing.
  An item with only unsupported values is skipped as unsupported. An item with
  no present part is skipped as empty. Skips count per source item.

### Provider mappings

- **1Password 1PUX**
  - Identity: person (names, birth date, email, first present phone) and
    address. Unix-second dates become ISO dates.
  - Passport: passport document with issuing country and issue and expiry
    dates.
  - Driver License: driver's license document. Its issuing country comes only
    from the country field, never the state. Its month-and-year expiry is not
    imported.
  - Bank Account: international or US bank account.
- **Bitwarden JSON**
  - Identity (`type: 4`): person, address, passport, and driver's license.
    Documents get no printed name, because Bitwarden exports none. SSN,
    company, username, and title are not imported.
- **Dashlane CSV or ZIP**
  - `ids.csv`: ID cards become national IDs; passports and driver's licenses
    map to their kinds. Other ID types are skipped.
  - `personalInfo.csv`: `name` rows become people and `address` rows become
    addresses. Email, phone, website, and company rows are skipped.
  - `payments.csv` `bank` rows: a number that starts with two letters is an
    IBAN with the routing column as SWIFT/BIC. Any other number is a US
    account with an ABA routing number. The bank name comes only from the
    issuing bank, never the account label.
- **LastPass CSV**
  - `Address` notes: person and address.
  - `Passport` and `Driver's License` notes: identity documents. The issuing
    country comes only from the country field, never the state.
  - `Bank Account` notes: international or US bank account.
  - `Credit Card` notes: cards. An invalid card is skipped as an invalid card.
  - A typed note also keeps one secure note with its original title and text
    when it has free-text Notes or any non-empty unmapped field. `Language` is
    export metadata and is ignored. A blank date written as bare commas counts
    as empty. A fully mapped note imports only its records.
  - An invalid typed note is skipped and keeps no secure note.
  - Other note types stay secure notes.
- **Proton Pass**
  - Identity: person, address, passport, and driver's license. A full name
    without split names is an unsupported person part; the other parts still
    import. Documents get no printed name. Work, social, and SSN details are
    not imported.
- **Keeper, Chrome-family, Apple Passwords, Google Authenticator, KeePassXC**
  - Unchanged. They produce no personal-data records.

Values the Nook types cannot represent stay unimported. Apart from text kept
in a LastPass secure note, they are not carried elsewhere.

- A person without a name, and an address with only a region or country.
- Phones beyond the one a person stores.
- A month-and-year-only document expiry.
- Account and routing numbers when an IBAN exists.
- Fields without a Nook equivalent, such as sex, height, license class,
  occupation, PIN, account type, and social security and tax numbers.
- Standalone email, phone, website, or company rows.

## Executable scenarios

- Rust tests in `nook-core/src/secrets/personal_data/` own normalization,
  required fields, calendar dates, email and phone shapes, document date
  order, IBAN shape and checksum, SWIFT/BIC length, account-number digits, ABA
  checksums, masking, redacted `Debug`, and zeroization.
- Rust tests in `secret_view/personal_data_*` cover typed forms, decrypt-path
  revalidation, safe list items, and the explicit detail view.
- `nook-auth2` tests cover wire names and category assignment. Fingerprint and
  `vault_session` tests cover per-type identities and category filtering.
- `nook-wasm` tests prove that list items stay masked while the detail view
  reveals fields, and that cards have no personal view.
- `import_support::personal` tests cover composite items, whole-item skips,
  bank type selection, and exported date conversion. Each importer's tests
  cover its provider mapping. A `nook-wasm` import test counts every record of
  a composite item and the skipped invalid item.
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
