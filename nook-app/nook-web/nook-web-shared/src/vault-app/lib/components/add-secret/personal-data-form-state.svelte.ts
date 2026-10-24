import {
  NookSecretFormFields,
  SecretType,
  type AddressSecretForm,
  type BankAccountSecretForm,
  type IdentityDocumentSecretForm,
  type PersonalDataView,
  type PersonSecretForm,
} from "$app-wasm";

/** Secret types edited through the personal-data forms (cards keep their own form). */
export type PersonalDataFormType =
  | SecretType.Person
  | SecretType.Address
  | SecretType.IdentityDocument
  | SecretType.BankAccount;

function emptyPerson(): PersonSecretForm {
  return {
    givenName: "",
    middleName: "",
    familyName: "",
    birthDate: "",
    email: "",
    phone: "",
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
    issuingCountry: "",
    issueDate: "",
    expiryDate: "",
    nameAsPrinted: "",
  };
}

function emptyBankAccount(): BankAccountSecretForm {
  return {
    accountHolder: "",
    bankName: "",
    accountNumber: "",
    routingCode: "",
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
  bankAccount = $state(emptyBankAccount());
  showDocumentNumber = $state(false);
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
          phone: view.phone,
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
          issuingCountry: view.issuingCountry,
          issueDate: view.issueDate,
          expiryDate: view.expiryDate,
          nameAsPrinted: view.nameAsPrinted,
        };
        return;
      case "bank-account":
        this.bankAccount = {
          accountHolder: view.accountHolder,
          bankName: view.bankName,
          accountNumber: view.accountNumber,
          routingCode: view.routingCode,
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
      case SecretType.BankAccount:
        return NookSecretFormFields.bank_account(
          $state.snapshot(this.bankAccount),
        );
    }
  }

  reset(): void {
    this.person = emptyPerson();
    this.address = emptyAddress();
    this.document = emptyDocument();
    this.bankAccount = emptyBankAccount();
    this.showDocumentNumber = false;
    this.showAccountNumber = false;
  }
}
