import { authenticatorSetupKeyChanged } from "$lib/nook";
import type {
  NookSecretRecord,
  SecretFormInput,
  VaultItemType,
} from "$lib/nook";
import { defaultPasswordGenerationOptions } from "$web-shared/password/generator";

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

  generationLength = $state(defaultPasswordGenerationOptions.length);
  generationUppercase = $state(defaultPasswordGenerationOptions.uppercase);
  generationLowercase = $state(defaultPasswordGenerationOptions.lowercase);
  generationNumbers = $state(defaultPasswordGenerationOptions.numbers);
  generationSymbols = $state(defaultPasswordGenerationOptions.symbols);

  load(item: NookSecretRecord): void {
    if (item.type === "login") {
      this.websiteUrl = item.websiteUrl;
      this.username = item.username;
      this.password = item.password;
      this.notes = item.notes ?? "";
    } else if (item.type === "api-key") {
      this.websiteUrl = item.websiteUrl;
      this.apiKey = item.primaryCredential || item.key;
      this.expiresAt = item.expiresAt ?? "";
    } else if (item.type === "seed-phrase") {
      this.accountName = item.name;
      this.seedPhrase = item.seed;
    } else if (item.type === "secure-note") {
      this.noteTitle = item.title;
      this.noteBody = item.note;
    } else if (item.type === "file-attachment") {
      this.fileTitle = item.title;
      this.fileName = item.fileName;
      this.fileMimeType = item.mimeType;
      this.fileSizeBytes = item.sizeBytes;
      this.fileContentBase64 = item.contentBase64;
    } else if (item.type === "authenticator") {
      this.websiteUrl = item.websiteUrl ?? "";
      this.authenticatorIssuer = item.issuer;
      this.authenticatorAccount = item.account;
      this.authenticatorSecret = item.totpSecret;
      this.authenticatorAlgorithm = item.algorithm;
      this.authenticatorDigits = String(item.digits);
      this.authenticatorPeriod = String(item.period);
      this.authenticatorBackupCodes = item.backupCodes.join("\n");
    } else if (item.type === "credit-card") {
      this.cardTitle = item.title;
      this.cardholderName = item.cardholderName;
      this.cardNumber = item.cardNumber;
      this.expirationMonth = item.expirationMonth;
      this.expirationYear = item.expirationYear;
      this.cardCvv = item.cvv;
      this.cardNotes = item.notes ?? "";
    }
  }

  toInput(
    selectedType: VaultItemType,
    initialItem: NookSecretRecord | undefined,
  ): SecretFormInput {
    if (selectedType === "login") {
      return {
        type: "login",
        websiteUrl: this.websiteUrl.trim(),
        username: this.username.trim(),
        password: this.password,
        notes: this.notes.trim(),
      };
    }
    if (selectedType === "api-key") {
      return {
        type: "api-key",
        websiteUrl: this.websiteUrl.trim(),
        key: this.apiKey,
        expiresAt: this.expiresAt,
      };
    }
    if (selectedType === "seed-phrase") {
      return {
        type: "seed-phrase",
        name: this.accountName.trim(),
        seed: this.seedPhrase.trim(),
      };
    }
    if (selectedType === "authenticator") {
      const setupKeyChanged =
        initialItem?.type === "authenticator" &&
        authenticatorSetupKeyChanged(
          initialItem.totpSecret,
          this.authenticatorSecret,
        );
      return {
        type: "authenticator",
        websiteUrl: this.websiteUrl.trim(),
        issuer: this.authenticatorIssuer.trim(),
        account: this.authenticatorAccount.trim(),
        totpSecret: this.authenticatorSecret.trim(),
        algorithm: setupKeyChanged ? "SHA1" : this.authenticatorAlgorithm,
        digits: setupKeyChanged ? "6" : this.authenticatorDigits,
        period: setupKeyChanged ? "30" : this.authenticatorPeriod,
        backupCodes: setupKeyChanged ? "" : this.authenticatorBackupCodes,
      };
    }
    if (selectedType === "credit-card") {
      return {
        type: "credit-card",
        title: this.cardTitle.trim(),
        cardholderName: this.cardholderName.trim(),
        number: this.cardNumber.trim(),
        expirationMonth: this.expirationMonth.trim(),
        expirationYear: this.expirationYear.trim(),
        cvv: this.cardCvv.trim(),
        notes: this.cardNotes.trim(),
      };
    }
    if (selectedType === "file-attachment") {
      return {
        type: "file-attachment",
        title: this.fileTitle.trim() || this.fileName.trim(),
        fileName: this.fileName.trim(),
        mimeType: this.fileMimeType.trim() || "application/octet-stream",
        sizeBytes: this.fileSizeBytes,
        contentBase64: this.fileContentBase64,
      };
    }
    return {
      type: "secure-note",
      title: this.noteTitle.trim(),
      note: this.noteBody,
    };
  }

  canSubmit(selectedType: VaultItemType | undefined, isSaving: boolean) {
    if (isSaving || !selectedType) return false;
    if (selectedType === "seed-phrase") return this.seedPhraseValid;
    if (selectedType === "secure-note") {
      return this.noteBody.trim().length > 0;
    }
    if (selectedType === "file-attachment") {
      return (
        this.fileContentBase64.length > 0 && this.fileName.trim().length > 0
      );
    }
    if (selectedType === "api-key") return this.apiKey.trim().length > 0;
    if (selectedType === "authenticator") {
      return (
        this.authenticatorSecret.trim().length > 0 &&
        (this.authenticatorIssuer.trim().length > 0 ||
          this.authenticatorSecret.trim().startsWith("otpauth://"))
      );
    }
    if (selectedType === "login") {
      return (
        this.websiteUrl.trim().length > 0 &&
        this.username.trim().length > 0 &&
        this.password.length > 0
      );
    }
    if (selectedType === "credit-card") {
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
