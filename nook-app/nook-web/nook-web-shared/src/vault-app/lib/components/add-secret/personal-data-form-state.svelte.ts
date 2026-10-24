import {
  NookSecretFormFields,
  SecretType,
  type AddressSecretForm,
  type DomesticAccountSecretForm,
  type InternationalAccountSecretForm,
  type IdentityDocumentSecretForm,
  type PersonalDataView,
  type PersonSecretForm,
} from "$app-wasm";

/** Secret types edited through the personal-data forms (cards keep their own form). */
export type PersonalDataFormType =
  | SecretType.Person
  | SecretType.Address
  | SecretType.IdentityDocument
  | SecretType.InternationalAccount
  | SecretType.DomesticAccount;

function emptyPerson(): PersonSecretForm {
  return {
    givenName: "",
    middleName: "",
    familyName: "",
    birthDate: "",
    email: "",
    mobilePhone: "",
    homePhone: "",
    workPhone: "",
  };
}

function emptyAddress(): AddressSecretForm {
  return {
    label: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
  };
}

function emptyDocument(): IdentityDocumentSecretForm {
  return {
    kind: "passport",
    number: "",
    issuer: "",
    issuingCountry: "",
    issueDate: "",
    expiryDate: "",
    nameAsPrinted: "",
  };
}

function emptyInternationalAccount(): InternationalAccountSecretForm {
  return {
    accountHolder: "",
    bankName: "",
    iban: "",
    swiftBic: "",
  };
}

function emptyDomesticAccount(): DomesticAccountSecretForm {
  return {
    accountHolder: "",
    bankName: "",
    accountNumber: "",
    routingNumber: "",
  };
}

/**
 * Unvalidated person, address, document and bank-account form input. Rust
 * trims, validates and normalizes every value when the form is submitted.
 */
export class PersonalDataFormState {
  person = $state(emptyPerson());
  address = $state(emptyAddress());
  document = $state(emptyDocument());
  internationalAccount = $state(emptyInternationalAccount());
  domesticAccount = $state(emptyDomesticAccount());
  showDocumentNumber = $state(false);
  showIban = $state(false);
  showAccountNumber = $state(false);

  /** Pre-fill the form from a decrypted record's Rust personal-data view. */
  load(view: PersonalDataView): void {
    switch (view.kind) {
      case "person":
        this.person = {
          givenName: view.givenName,
          middleName: view.middleName,
          familyName: view.familyName,
          birthDate: view.birthDate,
          email: view.email,
          mobilePhone: view.mobilePhone,
          homePhone: view.homePhone,
          workPhone: view.workPhone,
        };
        return;
      case "address":
        this.address = {
          label: view.label,
          addressLine1: view.addressLine1,
          addressLine2: view.addressLine2,
          city: view.city,
          region: view.region,
          postalCode: view.postalCode,
          country: view.country,
        };
        return;
      case "identity-document":
        this.document = {
          kind: view.documentKind,
          number: view.number,
          issuer: view.issuer,
          issuingCountry: view.issuingCountry,
          issueDate: view.issueDate,
          expiryDate: view.expiryDate,
          nameAsPrinted: view.nameAsPrinted,
        };
        return;
      case "international-account":
        this.internationalAccount = {
          accountHolder: view.accountHolder,
          bankName: view.bankName,
          iban: view.iban,
          swiftBic: view.swiftBic,
        };
        return;
      case "domestic-account":
        this.domesticAccount = {
          accountHolder: view.accountHolder,
          bankName: view.bankName,
          accountNumber: view.accountNumber,
          routingNumber: view.routingNumber,
        };
        return;
    }
  }

  /** The typed WASM form input; Rust rejects invalid values with i18n keys. */
  toFormFields(type: PersonalDataFormType): NookSecretFormFields {
    switch (type) {
      case SecretType.Person:
        return NookSecretFormFields.person($state.snapshot(this.person));
      case SecretType.Address:
        return NookSecretFormFields.address($state.snapshot(this.address));
      case SecretType.IdentityDocument:
        return NookSecretFormFields.identity_document(
          $state.snapshot(this.document),
        );
      case SecretType.InternationalAccount:
        return NookSecretFormFields.international_account(
          $state.snapshot(this.internationalAccount),
        );
      case SecretType.DomesticAccount:
        return NookSecretFormFields.domestic_account(
          $state.snapshot(this.domesticAccount),
        );
    }
  }

  reset(): void {
    this.person = emptyPerson();
    this.address = emptyAddress();
    this.document = emptyDocument();
    this.internationalAccount = emptyInternationalAccount();
    this.domesticAccount = emptyDomesticAccount();
    this.showDocumentNumber = false;
    this.showIban = false;
    this.showAccountNumber = false;
  }
}
