# Personal Field Autofill

## Overview

The extension fills person, address, and card fields from a record the user
selects. Rust decides which personal value each page field accepts and which
fields of the form receive values. The extension reports structural page facts,
renders the offer, and assigns the returned values. Records are specified in
[personal data items](../../../../nook-core/.cortex/docs/spec/personal-data-items.md).

`nook-page-policy` owns field classification, fill planning, and their shared
vocabulary. Companion protocol retains paired site-listing contracts.
`nook-core` owns record reveal and value projection. Both WASM bridges import
page-policy values directly. This ownership split preserves wire schemas,
storage formats, and public WASM behavior.

## Field groups and kinds

`PersonalFieldGroup` has three members: `Person`, `Address`, and `Card`.
`PersonalFieldKind::group()` assigns each kind to one group.

- **Person:** given, additional, family, and full name; birth date, day,
  month, and year; email; phone.
- **Address:** street address, address lines 1 and 2, address levels 1
  (region) and 2 (city), postal code, country code, and country name.
- **Card:** cardholder name, card number, expiration, expiration month and
  year, and security code.

## Classification

`PersonalFieldClassification::from_page_input` classifies one
`PageInputFieldObservation`. The observation is the same non-secret fact set
used for credential recognition.

1. Reject the input when it is a password, disabled, or read-only field.
2. Reject one-time-code fields and username fields in a login context.
3. Parse the autocomplete tokens with the WHATWG detail grammar. Skip
   `section-*`, `shipping` or `billing`, a contact hint before a contact field
   name, and a trailing `webauthn`. A lone `on` or `off` declares nothing.
4. Use a recognized personal field name as the kind, with `Autocomplete`
   evidence. Card fields use the `cc-*` names.
5. Stop when the tokens declare a known non-personal field name.
6. Otherwise fall back to identity text: whole-word phrases from the id, name,
   placeholder, title, ARIA label, and label. Ordered rules pick the most
   specific match. Qualifier words such as `company` or `website` block a
   generic name or address match. The result has `IdentityText` evidence.

An `email` input type selects Email in the fallback. Inputs of other
non-text types accept only declared field names.

## Fill planning

`PersonalFillScope` holds the observed inputs of the focused field's form in
document order. The position of each input is its fill index. `plan()` returns
a `PersonalFillOpportunity`.

- `Unavailable` names the reason: no focused field, several focused fields,
  too many observed fields, or an unclassified focused field.
- `Available` carries a `PersonalFillPlan` with the focused field's group and
  the fields of that group only.
- Fields with explicit autocomplete tokens always join the plan.
- The focused field claims its kind first. Each identity-text kind then joins
  at most once.

WASM exposes `classify_companion_personal_field`,
`PersonalFillScopeObservations`, and `plan_companion_personal_fill`.

## Explicit reveal

The extension asks for a personal opportunity only when the focused credential
opportunity is unavailable. It offers the planned group's records from the
paired vault sessions using list metadata only. The detailed widget flow
belongs to the
[browser extension specification](../../../../../nook-web/nook-web-extension/.cortex/docs/spec/browser-extension.md).

After the user selects one record, the extension calls
`NookVaultManager.reveal_personal_data_for_fill` with
`{ secretId, group, kinds }`. The call uses the same extension Simple Vault
capability as login fill. Personal data is not site-bound, so no origin
admission applies.

`nook-core::PersonalFillProjection` derives the values.

- It rejects a record outside the requested group and a kind outside the
  group. Identity documents, international accounts, and US bank accounts
  never fill.
- Full name joins the stored names. Birth day, month, and year come from the
  stored ISO date. An invalid stored birth date fails closed.
- Phone receives the mobile phone. Without a mobile phone it receives the home
  phone, then the work phone. A `home` or `work` contact hint does not change
  that order.
- Street address joins both address lines with a newline. Country code and
  country name both receive the stored country text.
- Card expiration is `MM/YY`. Month is `MM`, year is `YYYY`, and the security
  code is the stored CVV.
- Kinds without a stored value are omitted. Duplicate kinds fill once.

The response is `{ values: [{ kind, value }] }`. Rust copies are zeroized
after encoding, and `Debug` output shows no values.

## Login behavior

Login, password, and passkey behavior is unchanged. Credential recognition
runs first. Personal classification never claims a login-context username,
password, or one-time-code field.

## Executable scenarios

- `nook-page-policy` Rust tests cover the autocomplete grammar and identity-text
  rules. They also cover credential exclusions, unchanged credential
  recognition, and plans for sign-up, address, and card forms.
- `nook-page-policy` plan tests cover once-only identity-text kinds and
  fail-closed scopes.
- `nook-core` projection tests cover derivations, the phone order, group and
  kind rejection, invalid stored dates, redacted `Debug`, and zeroization.
- `nook-wasm` tests cover the typed request and response shapes and reveal only
  planned non-empty values.

## Out of scope (for now)

- Sign-up detection, registration drafts, and login-to-personal linking.
- Filling identity documents, international accounts, and US bank accounts.
- Automatic fill or submission without an explicit record selection.
