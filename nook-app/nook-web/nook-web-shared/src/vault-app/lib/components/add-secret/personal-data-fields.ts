import type {
  AddressSecretForm,
  DomesticAccountSecretForm,
  IdentityDocumentKind,
  IdentityDocumentSecretForm,
  InternationalAccountSecretForm,
  PersonSecretForm,
} from "$app-wasm";
import type { HTMLInputAttributes } from "svelte/elements";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import { SlotWidth } from "../vault/secret-slot";

/** Whether a form input shows its value or hides it behind a show toggle. */
export enum FieldConcealment {
  Plain = "plain",
  Concealable = "concealable",
}

/** The HTML input type of a personal-data form field. */
export enum PersonalInputType {
  Text = "text",
  Date = "date",
  Email = "email",
  Tel = "tel",
}

/** How one personal-data form input is labelled, typed and laid out. */
export type PersonalFieldSpec<Key extends string> = {
  readonly key: Key;
  readonly labelKey: string;
  readonly testId: string;
  readonly inputType: PersonalInputType;
  readonly autocomplete: HTMLInputAttributes["autocomplete"];
  readonly width: SlotWidth;
  readonly concealment: FieldConcealment;
  readonly placeholderKey: string;
  /** Format guidance shown under the input; empty when the label is enough. */
  readonly hintKey: string;
};

/** Defaults every field spec spreads before naming what differs. */
const FIELD_DEFAULTS = {
  inputType: PersonalInputType.Text,
  autocomplete: "off",
  width: SlotWidth.Half,
  concealment: FieldConcealment.Plain,
  placeholderKey: "",
  hintKey: "",
} as const satisfies Omit<
  PersonalFieldSpec<string>,
  "key" | "labelKey" | "testId"
>;

type PersonFieldKey = keyof PersonSecretForm;
type AddressFieldKey = keyof AddressSecretForm;
type DocumentFieldKey = Exclude<keyof IdentityDocumentSecretForm, "kind">;
type InternationalAccountFieldKey = keyof InternationalAccountSecretForm;
type DomesticAccountFieldKey = keyof DomesticAccountSecretForm;

export const PERSON_FIELDS: readonly PersonalFieldSpec<PersonFieldKey>[] = [
  {
    ...FIELD_DEFAULTS,
    key: "givenName",
    labelKey: I18N_KEYS.VaultFieldsGivenName,
    testId: "person-given-name",
    autocomplete: "given-name",
  },
  {
    ...FIELD_DEFAULTS,
    key: "familyName",
    labelKey: I18N_KEYS.VaultFieldsFamilyName,
    testId: "person-family-name",
    autocomplete: "family-name",
  },
  {
    ...FIELD_DEFAULTS,
    key: "middleName",
    labelKey: I18N_KEYS.VaultFieldsMiddleName,
    testId: "person-middle-name",
    autocomplete: "additional-name",
  },
  {
    ...FIELD_DEFAULTS,
    key: "birthDate",
    labelKey: I18N_KEYS.VaultFieldsBirthDate,
    testId: "person-birth-date",
    inputType: PersonalInputType.Date,
    autocomplete: "bday",
  },
  {
    ...FIELD_DEFAULTS,
    key: "email",
    labelKey: I18N_KEYS.VaultFieldsEmail,
    testId: "person-email",
    inputType: PersonalInputType.Email,
    autocomplete: "email",
  },
  {
    ...FIELD_DEFAULTS,
    key: "mobilePhone",
    labelKey: I18N_KEYS.VaultFieldsMobilePhone,
    testId: "person-mobile-phone",
    inputType: PersonalInputType.Tel,
    autocomplete: "mobile tel",
  },
  {
    ...FIELD_DEFAULTS,
    key: "homePhone",
    labelKey: I18N_KEYS.VaultFieldsHomePhone,
    testId: "person-home-phone",
    inputType: PersonalInputType.Tel,
    autocomplete: "home tel",
  },
  {
    ...FIELD_DEFAULTS,
    key: "workPhone",
    labelKey: I18N_KEYS.VaultFieldsWorkPhone,
    testId: "person-work-phone",
    inputType: PersonalInputType.Tel,
    autocomplete: "work tel",
  },
];

export const ADDRESS_FIELDS: readonly PersonalFieldSpec<AddressFieldKey>[] = [
  {
    ...FIELD_DEFAULTS,
    key: "label",
    labelKey: I18N_KEYS.VaultFieldsAddressLabel,
    testId: "address-label",
    width: SlotWidth.Full,
    placeholderKey: I18N_KEYS.AddSecretPlaceholderAddressLabel,
  },
  {
    ...FIELD_DEFAULTS,
    key: "addressLine1",
    labelKey: I18N_KEYS.VaultFieldsAddressLine1,
    testId: "address-line1",
    autocomplete: "address-line1",
    width: SlotWidth.Full,
  },
  {
    ...FIELD_DEFAULTS,
    key: "addressLine2",
    labelKey: I18N_KEYS.VaultFieldsAddressLine2,
    testId: "address-line2",
    autocomplete: "address-line2",
    width: SlotWidth.Full,
  },
  {
    ...FIELD_DEFAULTS,
    key: "city",
    labelKey: I18N_KEYS.VaultFieldsCity,
    testId: "address-city",
    autocomplete: "address-level2",
  },
  {
    ...FIELD_DEFAULTS,
    key: "region",
    labelKey: I18N_KEYS.VaultFieldsRegion,
    testId: "address-region",
    autocomplete: "address-level1",
  },
  {
    ...FIELD_DEFAULTS,
    key: "postalCode",
    labelKey: I18N_KEYS.VaultFieldsPostalCode,
    testId: "address-postal-code",
    autocomplete: "postal-code",
  },
  {
    ...FIELD_DEFAULTS,
    key: "country",
    labelKey: I18N_KEYS.VaultFieldsCountry,
    testId: "address-country",
    autocomplete: "country-name",
    placeholderKey: I18N_KEYS.AddSecretPlaceholderCountry,
  },
];

/** Label of the issuing body: a membership names its organization. */
export function documentIssuerLabelKey(kind: IdentityDocumentKind): string {
  switch (kind) {
    case "membership":
      return I18N_KEYS.VaultFieldsMembershipOrganization;
    case "passport":
    case "national-id":
    case "drivers-license":
    case "social-security":
    case "tax-id":
      return I18N_KEYS.VaultFieldsDocumentIssuer;
  }
}

/**
 * Document inputs for one kind. Dates are text so a month-only date
 * (`YYYY-MM`) can be entered; Rust validates both precisions.
 */
export function documentFields(
  kind: IdentityDocumentKind,
): readonly PersonalFieldSpec<DocumentFieldKey>[] {
  return [
    {
      ...FIELD_DEFAULTS,
      key: "number",
      labelKey: I18N_KEYS.VaultFieldsDocumentNumber,
      testId: "identity-document-number",
      concealment: FieldConcealment.Concealable,
    },
    {
      ...FIELD_DEFAULTS,
      key: "nameAsPrinted",
      labelKey: I18N_KEYS.VaultFieldsNameAsPrinted,
      testId: "identity-document-name",
    },
    {
      ...FIELD_DEFAULTS,
      key: "issuer",
      labelKey: documentIssuerLabelKey(kind),
      testId: "identity-document-issuer",
    },
    {
      ...FIELD_DEFAULTS,
      key: "issuingCountry",
      labelKey: I18N_KEYS.VaultFieldsIssuingCountry,
      testId: "identity-document-country",
      placeholderKey: I18N_KEYS.AddSecretPlaceholderCountry,
    },
    {
      ...FIELD_DEFAULTS,
      key: "issueDate",
      labelKey: I18N_KEYS.VaultFieldsIssueDate,
      testId: "identity-document-issue-date",
      hintKey: I18N_KEYS.AddSecretDocumentDateHint,
    },
    {
      ...FIELD_DEFAULTS,
      key: "expiryDate",
      labelKey: I18N_KEYS.VaultFieldsExpiryDate,
      testId: "identity-document-expiry-date",
      hintKey: I18N_KEYS.AddSecretDocumentDateHint,
    },
  ];
}

export const INTERNATIONAL_ACCOUNT_FIELDS: readonly PersonalFieldSpec<InternationalAccountFieldKey>[] =
  [
    {
      ...FIELD_DEFAULTS,
      key: "bankName",
      labelKey: I18N_KEYS.VaultFieldsBankName,
      testId: "international-account-bank-name",
    },
    {
      ...FIELD_DEFAULTS,
      key: "accountHolder",
      labelKey: I18N_KEYS.VaultFieldsAccountHolder,
      testId: "international-account-holder",
    },
    {
      ...FIELD_DEFAULTS,
      key: "iban",
      labelKey: I18N_KEYS.VaultFieldsIban,
      testId: "international-account-iban",
      width: SlotWidth.Full,
      concealment: FieldConcealment.Concealable,
    },
    {
      ...FIELD_DEFAULTS,
      key: "swiftBic",
      labelKey: I18N_KEYS.VaultFieldsSwiftBic,
      testId: "international-account-swift-bic",
    },
  ];

export const DOMESTIC_ACCOUNT_FIELDS: readonly PersonalFieldSpec<DomesticAccountFieldKey>[] =
  [
    {
      ...FIELD_DEFAULTS,
      key: "bankName",
      labelKey: I18N_KEYS.VaultFieldsBankName,
      testId: "domestic-account-bank-name",
    },
    {
      ...FIELD_DEFAULTS,
      key: "accountHolder",
      labelKey: I18N_KEYS.VaultFieldsAccountHolder,
      testId: "domestic-account-holder",
    },
    {
      ...FIELD_DEFAULTS,
      key: "accountNumber",
      labelKey: I18N_KEYS.VaultFieldsAccountNumber,
      testId: "domestic-account-number",
      width: SlotWidth.Full,
      concealment: FieldConcealment.Concealable,
    },
    {
      ...FIELD_DEFAULTS,
      key: "routingNumber",
      labelKey: I18N_KEYS.VaultFieldsRoutingNumber,
      testId: "domestic-account-routing-number",
    },
  ];

/** Document kinds in the order the form offers them. */
export const IDENTITY_DOCUMENT_KINDS: readonly IdentityDocumentKind[] = [
  "passport",
  "national-id",
  "drivers-license",
  "social-security",
  "tax-id",
  "membership",
];

/** Translation key that names one identity-document kind. */
export function documentKindLabelKey(kind: IdentityDocumentKind): string {
  switch (kind) {
    case "passport":
      return I18N_KEYS.VaultDocumentKindsPassport;
    case "national-id":
      return I18N_KEYS.VaultDocumentKindsNationalId;
    case "drivers-license":
      return I18N_KEYS.VaultDocumentKindsDriversLicense;
    case "social-security":
      return I18N_KEYS.VaultDocumentKindsSocialSecurity;
    case "tax-id":
      return I18N_KEYS.VaultDocumentKindsTaxId;
    case "membership":
      return I18N_KEYS.VaultDocumentKindsMembership;
  }
}
