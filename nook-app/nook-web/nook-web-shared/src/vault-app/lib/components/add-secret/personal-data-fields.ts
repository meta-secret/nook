import type {
  AddressSecretForm,
  BankAccountSecretForm,
  IdentityDocumentKind,
  IdentityDocumentSecretForm,
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

/** How one personal-data form input is labelled, typed and laid out. */
export type PersonalFieldSpec<Key extends string> = {
  readonly key: Key;
  readonly labelKey: string;
  readonly testId: string;
  readonly inputType: "text" | "date" | "email" | "tel";
  readonly autocomplete: HTMLInputAttributes["autocomplete"];
  readonly width: SlotWidth;
  readonly concealment: FieldConcealment;
  readonly placeholderKey: string;
};

/** Defaults every field spec spreads before naming what differs. */
const FIELD_DEFAULTS = {
  inputType: "text",
  autocomplete: "off",
  width: SlotWidth.Half,
  concealment: FieldConcealment.Plain,
  placeholderKey: "",
} as const satisfies Omit<
  PersonalFieldSpec<string>,
  "key" | "labelKey" | "testId"
>;

type PersonFieldKey = keyof PersonSecretForm;
type AddressFieldKey = keyof AddressSecretForm;
type DocumentFieldKey = Exclude<keyof IdentityDocumentSecretForm, "kind">;
type BankAccountFieldKey = keyof BankAccountSecretForm;

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
    inputType: "date",
    autocomplete: "bday",
  },
  {
    ...FIELD_DEFAULTS,
    key: "email",
    labelKey: I18N_KEYS.VaultFieldsEmail,
    testId: "person-email",
    inputType: "email",
    autocomplete: "email",
  },
  {
    ...FIELD_DEFAULTS,
    key: "phone",
    labelKey: I18N_KEYS.VaultFieldsPhone,
    testId: "person-phone",
    inputType: "tel",
    autocomplete: "tel",
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

export const DOCUMENT_FIELDS: readonly PersonalFieldSpec<DocumentFieldKey>[] = [
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
    width: SlotWidth.Full,
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
    inputType: "date",
  },
  {
    ...FIELD_DEFAULTS,
    key: "expiryDate",
    labelKey: I18N_KEYS.VaultFieldsExpiryDate,
    testId: "identity-document-expiry-date",
    inputType: "date",
  },
];

export const BANK_ACCOUNT_FIELDS: readonly PersonalFieldSpec<BankAccountFieldKey>[] =
  [
    {
      ...FIELD_DEFAULTS,
      key: "bankName",
      labelKey: I18N_KEYS.VaultFieldsBankName,
      testId: "bank-account-bank-name",
    },
    {
      ...FIELD_DEFAULTS,
      key: "accountHolder",
      labelKey: I18N_KEYS.VaultFieldsAccountHolder,
      testId: "bank-account-holder",
    },
    {
      ...FIELD_DEFAULTS,
      key: "accountNumber",
      labelKey: I18N_KEYS.VaultFieldsAccountNumber,
      testId: "bank-account-number",
      width: SlotWidth.Full,
      concealment: FieldConcealment.Concealable,
      placeholderKey: I18N_KEYS.AddSecretPlaceholderBankAccountNumber,
    },
    {
      ...FIELD_DEFAULTS,
      key: "routingCode",
      labelKey: I18N_KEYS.VaultFieldsRoutingCode,
      testId: "bank-account-routing-code",
    },
  ];

/** Document kinds in the order the form offers them. */
export const IDENTITY_DOCUMENT_KINDS: readonly IdentityDocumentKind[] = [
  "passport",
  "national-id",
  "drivers-license",
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
  }
}
