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
the empty string when absent.

- **Dates**
  - A birth date is a strict ISO `YYYY-MM-DD` value that exists in the
    Gregorian calendar.
  - A document issue or expiry date is such a full date or a strict `YYYY-MM`
    month. It keeps the precision it was entered with.
  - Malformed dates and two-digit years are rejected.
- **Person**
  - `givenName`, `middleName`, `familyName`: at least one of given or family
    name is required.
  - `birthDate`: optional full date.
  - `email`: optional `local@domain.tld` shape without whitespace.
  - `mobilePhone`, `homePhone`, `workPhone`: three flat optional phones. Each
    accepts digits plus `+ ( ) - .` and spaces, with at least one digit.
- **Address**
  - `label`: optional, such as `Home`.
  - `addressLine1`: required.
  - `addressLine2`, `city`, `region`, `postalCode`: optional.
  - `country`: optional name or code, stored as typed.
- **Identity document**
  - `kind`: `passport`, `national-id`, `drivers-license`, `social-security`,
    `tax-id`, or `membership`.
  - `number`: required for every kind.
    - Social Security: a US number of nine digits, stored without spaces or
      dashes. Area 000, 666, and 900–999, group 00, and serial 0000 are
      rejected as never issued.
    - Tax ID and membership: non-empty trimmed text.
  - `issuer`: optional issuing organization.
  - `issuingCountry`, `nameAsPrinted`: optional for every kind.
  - `issueDate`, `expiryDate`: optional document dates. Expiry is never before
    issue. When either date is month-only, the two compare by month.
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

Identity-document numbers of every kind, IBANs, and US account numbers share
the card masking rule. Social Security and tax ID numbers are therefore
masked. List rows and the default detail show `••••` plus a short tail.
The tail has at most four characters and never more than half of the number.
A short number therefore never appears in full.

The SWIFT/BIC and the ABA routing number are public bank identifiers. They are
shown plain.

## List and detail security

List projections carry only safe metadata.

- **Person:** full name and email.
- **Address:** label, first line, city, and country.
- **Identity document:** kind, name as printed, issuer, masked tail, and
  expiry date. A membership is titled by its issuer, then its printed name.
  Other kinds are titled by the printed name, then the issuer.
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

## Vault forms

- Person forms and details show the mobile, home, and work phones.
- The document type is a radio-group picker of six tiles, one per kind. It
  replaces the native select. Arrow keys move the choice.
- Document forms add the issuer field, labelled Organization for a
  membership.
- Issue and expiry dates are text inputs with a `YYYY-MM or YYYY-MM-DD` hint.
  Details show dates as stored.

## Recorded decisions

The host decided these import-gap rules for the user:

- Documents gain the Social Security, tax ID, and membership kinds and an
  optional issuer. Issuing country is optional for every kind.
- A person stores three flat optional phones instead of one.
- Document dates accept `YYYY-MM` and keep their precision. Birth date stays a
  full date.
- A bank item carrying both an IBAN and a US account with routing number
  produces both accounts.
- LastPass Evening Phone is the home phone.

Gizmo Prime decided the Social Security import split under
[import](#import). A generic SSN field never blocks the rest of its identity.
A typed Social Security item fails as a whole.

## Compatibility decision

Nook has no released versions. The new types and the changed filter enums use
the new format only. They have no migrations, legacy readers, compatibility
branches, aliases, or version gates. The earlier single `bank-account` type is
removed with its wire name and shape; nothing reads it.

## Import

Importers describe each source item as person, address, document, and bank
parts. Every present part is validated by its payload constructor.

- One composite source item may produce several records. A Bitwarden identity
  can yield a person, an address, a passport, a driver's license, and a
  Social Security number.
- A person needs a given, middle, or family name. Contact details alone form
  no person.
- An address needs a street line, city, or postal code. A region or country
  alone forms no address.
- A document needs its number.
- A bank part with an IBAN becomes an international account. An account
  number with a routing number becomes a US bank account. An item carrying
  both produces both records, counted as two. Other bank values fit no type
  and are not imported.
- No field substitutes for another. A missing value stays empty instead of
  being derived from a neighbouring field.
- An unlabelled source phone becomes the mobile phone only when the source
  stores no mobile phone.
- `Month,Day,Year` dates need a four-digit year. A document date written
  without a day keeps month precision as `YYYY-MM`.
- One invalid present part skips the whole source item with
  `InvalidPersonalData`. Values are never coerced, and the item never falls
  back to a secure note.
- **Social Security numbers**
  - A generic SSN field is Bitwarden `ssn` or Proton Pass
    `socialSecurityNumber`. A value there that is not a valid US SSN, such as
    an ITIN, is an unsupported part. It is not imported, and the identity's
    other parts still import.
  - A typed Social Security item is a 1Password SSN item, a LastPass Social
    Security note, or a Dashlane `ids.csv` social security row. A malformed
    number skips that item as invalid.
- An unsupported part does not stop the item's other parts from importing.
  An item with only unsupported values is skipped as unsupported. An item with
  no present part is skipped as empty. Skips count per source item.

### Provider mappings

- **1Password 1PUX**
  - Identity: person and address. The person takes names, birth date, email,
    and phones. Cell, home, and business phones become the mobile, home, and
    work phones. The default phone is the mobile phone only when no cell phone
    is stored. Unix-second dates become ISO dates.
  - Passport: passport document with issuing country, the issuing authority as
    issuer, and issue and expiry dates.
  - Driver License: driver's license document. Its issuing country comes only
    from the country field, never the state. Its month-and-year expiry keeps
    month precision.
  - Social Security Number (category `108`): Social Security document.
  - Membership (category `105`): membership document. The organization is the
    issuer and member-since is the issue date. A month-and-year expiry keeps
    month precision.
  - Bank Account: international account, US bank account, or both.
- **Bitwarden JSON**
  - Identity (`type: 4`): person, address, passport, driver's license, and
    Social Security document from `ssn`. Bitwarden's single phone is the
    mobile phone. Documents get no printed name, because Bitwarden exports
    none. Company, username, and title are not imported.
- **Dashlane CSV or ZIP**
  - `ids.csv`: ID cards become national IDs. Passports, driver's licenses,
    social security rows, and tax number rows map to their kinds. Other ID
    types are skipped.
  - `personalInfo.csv`: `name` rows become people and `address` rows become
    addresses. Email, phone, website, and company rows carry no name to join a
    person, so they are skipped.
  - `payments.csv` `bank` rows: a number that starts with two letters is an
    IBAN with the routing column as SWIFT/BIC. Any other number is a US
    account with an ABA routing number. The bank name comes only from the
    issuing bank, never the account label.
- **LastPass CSV**
  - `Address` notes: person and address. Mobile Phone is the mobile phone and
    Evening Phone is the home phone. The unlabelled Phone is the mobile phone
    only when Mobile Phone is empty. Otherwise it stays in the kept secure
    note.
  - `Passport` and `Driver's License` notes: identity documents. The issuing
    country comes only from the country field, never the state. A passport's
    issuing authority is its issuer.
  - `Social Security` notes: Social Security documents.
  - `Membership` notes: membership documents. The organization is the issuer
    and the start date is the issue date.
  - Document dates without a day keep month precision as `YYYY-MM`.
  - `Bank Account` notes: international account, US bank account, or both.
  - `Credit Card` notes: cards. An invalid card is skipped as an invalid card.
  - A typed note also keeps one secure note with its original title and text
    when it has free-text Notes or any non-empty unmapped field. `Language` is
    export metadata and is ignored. A blank date written as bare commas counts
    as empty. A fully mapped note imports only its records.
  - An invalid typed note is skipped and keeps no secure note.
  - Other note types stay secure notes.
- **Proton Pass**
  - Identity: person, address, passport, driver's license, and Social Security
    document from `socialSecurityNumber`. The primary phone is the mobile
    phone and `workPhoneNumber` is the work phone. A full name without split
    names is an unsupported person part; the other parts still import.
    Documents get no printed name. Proton Pass exports no tax ID. Social and
    other work details are not imported.
- **Keeper, Chrome-family, Apple Passwords, Google Authenticator, KeePassXC**
  - Unchanged. They produce no personal-data records.

Values the Nook types cannot represent stay unimported. Apart from text kept
in a LastPass secure note, they are not carried elsewhere.

- A person without a name, and an address with only a region or country.
- Proton Pass's unlabelled second phone.
- The 1Password default phone when it differs from the cell phone.
- The LastPass fax number.
- Dashlane `personalInfo.csv` email, phone, website, and company rows.
- A US account number without a routing number next to an IBAN.
- 1Password membership website, phone, and PIN.
- Driver's license class, sex, height, nationality, and conditions.
- Non-US SSNs in generic SSN fields.
- Company, occupation, bank account type, and social details.

## Executable scenarios

- Rust tests in `nook-core/src/secrets/personal_data/` own normalization,
  required fields, calendar dates and months, email and phone shapes, the
  preferred phone order, Social Security numbers, document date order by day
  or month, IBAN shape and checksum, SWIFT/BIC length, account-number digits, ABA
  checksums, masking, redacted `Debug`, and zeroization.
- Rust tests in `secret_view/personal_data_*` cover typed forms, decrypt-path
  revalidation, safe list items, and the explicit detail view.
- `nook-auth2` tests cover wire names and category assignment. Fingerprint and
  `vault_session` tests cover per-type identities and category filtering.
- `nook-wasm` tests prove that list items stay masked while the detail view
  reveals fields, and that cards have no personal view.
- `import_support::personal` tests cover composite items, whole-item skips,
  bank type selection including dual bank records, and exported day and
  month date conversion. Each importer's tests
  cover its provider mapping. A `nook-wasm` import test counts every record of
  a composite item and the skipped invalid item.
- Web unit tests cover section switching, section filters, the add picker,
  typed form DTOs, Rust validation keys, edit pre-fill, and sealed detail.
  They also cover the document kind picker, the three phones, the issuer, and
  dates shown as stored.
- Existing card and import Playwright specs open the Personal data section
  before checking cards.

## Out of scope (for now)

- Sign-up detection and registration drafts.
- Linking a login to its personal data.
- Browser fill of identity documents and bank accounts. Person, address, and
  card fill follows the
  [personal field autofill](../../../../nook-companion-core/.cortex/docs/spec/personal-field-autofill.md)
  specification.
