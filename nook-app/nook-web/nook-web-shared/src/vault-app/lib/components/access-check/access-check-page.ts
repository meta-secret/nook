import type { NookAccessCheckSource } from "$app-wasm";

/** Where the access check page reads identity logs and vaults from. */
export enum AccessCheckSourceKind {
  ThisBrowser = "thisBrowser",
  GoogleDrive = "googleDrive",
  LocalFolder = "localFolder",
}

/** What the page checks: one passkey or one typed backup password. */
export enum AccessCheckMethod {
  Passkey = "passkey",
  BackupPassword = "backupPassword",
}

export enum PreparedSourceKind {
  Pending = "pending",
  Ready = "ready",
}

/** Whether the chosen source can be read yet: Drive needs a sign-in and a
 * folder needs choosing first. */
export type PreparedSource =
  | { readonly kind: PreparedSourceKind.Pending }
  | {
      readonly kind: PreparedSourceKind.Ready;
      readonly source: NookAccessCheckSource;
    };

export const ACCESS_CHECK_SOURCES: readonly AccessCheckSourceKind[] = [
  AccessCheckSourceKind.ThisBrowser,
  AccessCheckSourceKind.GoogleDrive,
  AccessCheckSourceKind.LocalFolder,
];
