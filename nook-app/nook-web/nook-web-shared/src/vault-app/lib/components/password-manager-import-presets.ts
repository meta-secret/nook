import { PASSWORD_IMPORT_MESSAGE_KEYS } from "../../../generated/i18n-keys";
import { PasswordImportFormat } from "./password-manager-import-state";

export const PASSWORD_IMPORT_PRESETS = {
  ApplePasswords: {
    providerId: "apple-passwords",
    fileTestId: "apple-passwords-csv-file",
    accept: ".csv,.zip,text/csv,application/zip,application/x-zip-compressed",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.ApplePasswords,
    format: PasswordImportFormat.Binary,
  },
  ChromePasswords: {
    providerId: "chrome-passwords",
    fileTestId: "chrome-passwords-csv-file",
    accept: ".csv,text/csv",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.ChromePasswords,
    format: PasswordImportFormat.Text,
  },
  Dashlane: {
    providerId: "dashlane",
    fileTestId: "dashlane-export-file",
    accept: ".csv,.zip,text/csv,application/zip,application/x-zip-compressed",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.Dashlane,
    format: PasswordImportFormat.Binary,
  },
  KeePassXc: {
    providerId: "keepassxc",
    fileTestId: "keepassxc-csv-file",
    accept: ".csv,text/csv,application/csv",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.KeePassXc,
    format: PasswordImportFormat.Text,
  },
  LastPass: {
    providerId: "lastpass",
    fileTestId: "lastpass-csv-file",
    accept: ".csv,text/csv,application/csv",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.LastPass,
    format: PasswordImportFormat.Text,
  },
  Keeper: {
    providerId: "keeper",
    fileTestId: "keeper-csv-file",
    accept: ".csv,text/csv,application/csv",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.Keeper,
    format: PasswordImportFormat.Text,
  },
  OnePassword: {
    providerId: "onepassword",
    fileTestId: "onepassword-pux-file",
    accept: ".1pux,application/zip,application/x-zip-compressed",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.OnePassword,
    format: PasswordImportFormat.Binary,
  },
  ProtonPass: {
    providerId: "proton-pass",
    fileTestId: "proton-pass-export-file",
    accept:
      ".zip,.json,application/zip,application/x-zip-compressed,application/json",
    messages: PASSWORD_IMPORT_MESSAGE_KEYS.ProtonPass,
    format: PasswordImportFormat.Binary,
  },
} as const;
