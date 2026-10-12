import { SecretType, type NookSecretRecord } from "$lib/nook";
import { I18N_KEYS as K, type I18nKey } from "../../../generated/i18n-keys";
import type { SecretFormState } from "$lib/components/add-secret/secret-form-state.svelte";

type TextDraftKey = {
  [P in keyof SecretFormState]: SecretFormState[P] extends string ? P : never;
}[keyof SecretFormState];
export type ItemField = {
  draft: TextDraftKey;
  record: keyof NookSecretRecord;
  label: I18nKey;
  multiline?: boolean;
  secret?: boolean;
};
export const itemTypes = [
  { type: SecretType.Login, label: K.VaultTypesLogin },
  { type: SecretType.SecureNote, label: K.VaultTypesSecureNote },
  { type: SecretType.ApiKey, label: K.VaultTypesApiKey },
  { type: SecretType.SeedPhrase, label: K.VaultTypesSeedPhrase },
  { type: SecretType.Authenticator, label: K.VaultTypesAuthenticator },
  { type: SecretType.CreditCard, label: K.VaultTypesCreditCard },
];
export function itemFields(type: SecretType): ItemField[] {
  switch (type) {
    case SecretType.Login:
      return [
        {
          draft: "websiteUrl",
          record: "websiteUrl",
          label: K.VaultFieldsWebsiteLabel,
        },
        { draft: "username", record: "username", label: K.VaultFieldsUsername },
        {
          draft: "password",
          record: "password",
          label: K.VaultFieldsPassword,
          secret: true,
        },
        {
          draft: "notes",
          record: "notes",
          label: K.VaultFieldsNotes,
          multiline: true,
        },
      ];
    case SecretType.SecureNote:
      return [
        { draft: "noteTitle", record: "title", label: K.VaultFieldsTitle },
        {
          draft: "noteBody",
          record: "note",
          label: K.VaultFieldsNote,
          multiline: true,
        },
      ];
    case SecretType.ApiKey:
      return [
        {
          draft: "websiteUrl",
          record: "websiteUrl",
          label: K.VaultFieldsWebsiteLabel,
        },
        {
          draft: "apiKey",
          record: "key",
          label: K.VaultFieldsKey,
          secret: true,
        },
        {
          draft: "expiresAt",
          record: "expiresAt",
          label: K.VaultFieldsExpiresAt,
        },
      ];
    case SecretType.SeedPhrase:
      return [
        { draft: "accountName", record: "name", label: K.VaultFieldsAccount },
        {
          draft: "seedPhrase",
          record: "seed",
          label: K.VaultFieldsWords,
          multiline: true,
        },
      ];
    case SecretType.Authenticator:
      return [
        {
          draft: "authenticatorIssuer",
          record: "issuer",
          label: K.VaultFieldsIssuer,
        },
        {
          draft: "authenticatorAccount",
          record: "account",
          label: K.VaultFieldsAccount,
        },
        {
          draft: "websiteUrl",
          record: "websiteUrl",
          label: K.VaultFieldsWebsiteLabel,
        },
        {
          draft: "authenticatorSecret",
          record: "totpSecret",
          label: K.VaultFieldsAuthenticatorSecret,
          secret: true,
        },
        {
          draft: "authenticatorBackupCodes",
          record: "backupCodes",
          label: K.VaultFieldsBackupCodes,
          multiline: true,
        },
      ];
    case SecretType.CreditCard:
      return [
        { draft: "cardTitle", record: "title", label: K.VaultFieldsTitle },
        {
          draft: "cardholderName",
          record: "cardholderName",
          label: K.VaultFieldsCardholderName,
        },
        {
          draft: "cardNumber",
          record: "cardNumber",
          label: K.VaultFieldsCardNumber,
          secret: true,
        },
        {
          draft: "expirationMonth",
          record: "expirationMonth",
          label: K.AddSecretPlaceholderExpirationMonth,
        },
        {
          draft: "expirationYear",
          record: "expirationYear",
          label: K.AddSecretPlaceholderExpirationYear,
        },
        {
          draft: "cardCvv",
          record: "cvv",
          label: K.VaultFieldsCvv,
          secret: true,
        },
        {
          draft: "cardNotes",
          record: "notes",
          label: K.VaultFieldsNotes,
          multiline: true,
        },
      ];
    case SecretType.Passkey:
    case SecretType.FileAttachment:
      return [];
  }
}
