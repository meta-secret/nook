type SecretFormFieldProjection = {
  readonly selectedType: SecretType;
  readonly editor: SecretEditor;
};

type SecretFormSubmissionAssessment = {
  readonly selectedType: SecretType;
  readonly isSaving: boolean;
};

import {
  authenticator_setup_key_changed,
  default_password_generation_options,
  SecretType,
} from "$lib/nook";
import type { NookSecretRecord } from "$lib/nook";
import { NookSecretFormFields } from "$app-wasm";
import { SecretEditorKind, type SecretEditor } from "../secret-vault-state";

const passwordGenerationDefaults = default_password_generation_options();

export class SecretFormState {
  showPasswordOptions = $state(false);
  showPasswordValue = $state(false);

  websiteUrl = $state("");
  username = $state("");
  password = $state("");
  notes = $state("");
  apiKey = $state("");
  expiresAt = $state("");
  accountName = $state("");
  seedPhrase = $state("");
  seedPhraseValid = $state(false);
  noteTitle = $state("");
  noteBody = $state("");
  fileTitle = $state("");
  fileName = $state("");
  fileMimeType = $state("");
  fileSizeBytes = $state(0);
  fileContentBase64 = $state("");
  fileInputError = $state("");
  authenticatorIssuer = $state("");
  authenticatorAccount = $state("");
  authenticatorSecret = $state("");
  authenticatorAlgorithm = $state("SHA1");
  authenticatorDigits = $state("6");
  authenticatorPeriod = $state("30");
  authenticatorBackupCodes = $state("");
  cardTitle = $state("");
  cardholderName = $state("");
  cardNumber = $state("");
  expirationMonth = $state("");
  expirationYear = $state("");
  cardCvv = $state("");
  cardNotes = $state("");
  showCardNumber = $state(false);
  showCvv = $state(false);
  submitError = $state("");

  generationLength = $state(passwordGenerationDefaults.length);
  generationUppercase = $state(passwordGenerationDefaults.uppercase);
  generationLowercase = $state(passwordGenerationDefaults.lowercase);
  generationNumbers = $state(passwordGenerationDefaults.numbers);
  generationSymbols = $state(passwordGenerationDefaults.symbols);

  load(item: NookSecretRecord): void {
    if (item.type === SecretType.Login) {
      this.websiteUrl = item.websiteUrl;
      this.username = item.username;
      this.password = item.password;
      this.notes = ((v) => (v ? v : ""))(item.notes);
    } else if (item.type === SecretType.ApiKey) {
      this.websiteUrl = item.websiteUrl;
      this.apiKey = item.primaryCredential || item.key;
      this.expiresAt = ((v) => (v ? v : ""))(item.expiresAt);
    } else if (item.type === SecretType.SeedPhrase) {
      this.accountName = item.name;
      this.seedPhrase = item.seed;
    } else if (item.type === SecretType.SecureNote) {
      this.noteTitle = item.title;
      this.noteBody = item.note;
    } else if (item.type === SecretType.FileAttachment) {
      this.fileTitle = item.title;
      this.fileName = item.fileName;
      this.fileMimeType = item.mimeType;
      this.fileSizeBytes = item.sizeBytes;
      this.fileContentBase64 = item.contentBase64;
    } else if (item.type === SecretType.Authenticator) {
      this.websiteUrl = ((v) => (v ? v : ""))(item.websiteUrl);
      this.authenticatorIssuer = item.issuer;
      this.authenticatorAccount = item.account;
      this.authenticatorSecret = item.totpSecret;
      this.authenticatorAlgorithm = item.algorithm;
      this.authenticatorDigits = String(item.digits);
      this.authenticatorPeriod = String(item.period);
      this.authenticatorBackupCodes = item.backupCodes.join("\n");
    } else if (item.type === SecretType.CreditCard) {
      this.cardTitle = item.title;
      this.cardholderName = item.cardholderName;
      this.cardNumber = item.cardNumber;
      this.expirationMonth = item.expirationMonth;
      this.expirationYear = item.expirationYear;
      this.cardCvv = item.cvv;
      this.cardNotes = ((v) => (v ? v : ""))(item.notes);
    }
  }

  toFormFields({
    selectedType,
    editor,
  }: SecretFormFieldProjection): NookSecretFormFields {
    if (selectedType === SecretType.Login) {
      return NookSecretFormFields.login(
        this.websiteUrl.trim(),
        this.username.trim(),
        this.password,
        this.notes.trim(),
      );
    }
    if (selectedType === SecretType.ApiKey) {
      return NookSecretFormFields.api_key(
        this.websiteUrl.trim(),
        this.apiKey,
        this.expiresAt,
      );
    }
    if (selectedType === SecretType.SeedPhrase) {
      return NookSecretFormFields.seed_phrase(
        this.accountName.trim(),
        this.seedPhrase.trim(),
      );
    }
    if (selectedType === SecretType.Authenticator) {
      const setupKeyChanged =
        editor.kind === SecretEditorKind.Editing &&
        editor.record.type === SecretType.Authenticator &&
        authenticator_setup_key_changed(
          editor.record.totpSecret,
          this.authenticatorSecret,
        );
      return NookSecretFormFields.authenticator(
        this.authenticatorIssuer.trim(),
        this.authenticatorAccount.trim(),
        this.websiteUrl.trim(),
        this.authenticatorSecret.trim(),
        setupKeyChanged ? "SHA1" : this.authenticatorAlgorithm,
        setupKeyChanged ? "6" : this.authenticatorDigits,
        setupKeyChanged ? "30" : this.authenticatorPeriod,
        setupKeyChanged ? "" : this.authenticatorBackupCodes,
      );
    }
    if (selectedType === SecretType.CreditCard) {
      return NookSecretFormFields.credit_card(
        this.cardTitle.trim(),
        this.cardholderName.trim(),
        this.cardNumber.trim(),
        this.expirationMonth.trim(),
        this.expirationYear.trim(),
        this.cardCvv.trim(),
        this.cardNotes.trim(),
      );
    }
    if (selectedType === SecretType.FileAttachment) {
      return NookSecretFormFields.file_attachment(
        this.fileTitle.trim() || this.fileName.trim(),
        this.fileName.trim(),
        this.fileMimeType.trim() || "application/octet-stream",
        this.fileSizeBytes,
        this.fileContentBase64,
      );
    }
    return NookSecretFormFields.secure_note(
      this.noteTitle.trim(),
      this.noteBody,
    );
  }

  canSubmit({ selectedType, isSaving }: SecretFormSubmissionAssessment) {
    if (isSaving) return false;
    if (selectedType === SecretType.Login) {
      return (
        this.websiteUrl.trim().length > 0 &&
        this.username.trim().length > 0 &&
        this.password.length > 0
      );
    }
    if (selectedType === SecretType.SeedPhrase) return this.seedPhraseValid;
    if (selectedType === SecretType.SecureNote) {
      return this.noteBody.trim().length > 0;
    }
    if (selectedType === SecretType.FileAttachment) {
      return (
        this.fileContentBase64.length > 0 && this.fileName.trim().length > 0
      );
    }
    if (selectedType === SecretType.ApiKey)
      return this.apiKey.trim().length > 0;
    if (selectedType === SecretType.Authenticator) {
      return (
        this.authenticatorSecret.trim().length > 0 &&
        (this.authenticatorIssuer.trim().length > 0 ||
          this.authenticatorSecret.trim().startsWith("otpauth://"))
      );
    }
    if (selectedType === SecretType.CreditCard) {
      return (
        this.cardTitle.trim().length > 0 && this.cardNumber.trim().length > 0
      );
    }
    return false;
  }

  reset(): void {
    this.websiteUrl = "";
    this.username = "";
    this.password = "";
    this.notes = "";
    this.apiKey = "";
    this.expiresAt = "";
    this.accountName = "";
    this.seedPhrase = "";
    this.seedPhraseValid = false;
    this.noteTitle = "";
    this.noteBody = "";
    this.fileTitle = "";
    this.fileName = "";
    this.fileMimeType = "";
    this.fileSizeBytes = 0;
    this.fileContentBase64 = "";
    this.fileInputError = "";
    this.authenticatorIssuer = "";
    this.authenticatorAccount = "";
    this.authenticatorSecret = "";
    this.authenticatorAlgorithm = "SHA1";
    this.authenticatorDigits = "6";
    this.authenticatorPeriod = "30";
    this.authenticatorBackupCodes = "";
    this.cardTitle = "";
    this.cardholderName = "";
    this.cardNumber = "";
    this.expirationMonth = "";
    this.expirationYear = "";
    this.cardCvv = "";
    this.cardNotes = "";
    this.submitError = "";
    this.showPasswordOptions = false;
    this.showPasswordValue = false;
    this.showCardNumber = false;
    this.showCvv = false;
  }
}
