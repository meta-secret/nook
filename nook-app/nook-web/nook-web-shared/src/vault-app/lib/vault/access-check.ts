import { err, ok, type Result } from "neverthrow";
import {
  check_backup_password_access,
  check_passkey_access,
  type CredentialCheckReport,
  type NookAccessCheckSource,
  type VaultCheck,
} from "$app-wasm";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

export enum AccessCheckFailureKind {
  Passkey = "passkey",
  BackupPassword = "backup-password",
}

/** A check that could not finish; what it says to the user. */
export class AccessCheckFailure {
  constructor(readonly kind: AccessCheckFailureKind) {}

  get translationKey(): I18nKey {
    switch (this.kind) {
      case AccessCheckFailureKind.Passkey:
        return I18N_KEYS.AccessCheckPasskeyFailed;
      case AccessCheckFailureKind.BackupPassword:
        return I18N_KEYS.AccessCheckFailed;
    }
  }
}

/** A typed backup password and the source to check it against. */
export type BackupPasswordCheckRequest = {
  readonly source: NookAccessCheckSource;
  readonly password: string;
};

/**
 * Read-only checks of which vaults a passkey or backup password opens. Rust
 * decrypts in memory and reports each vault by name; nothing is stored,
 * imported, or written to the source.
 */
export class AccessCheckActions {
  async checkPasskey(
    source: NookAccessCheckSource,
  ): Promise<Result<CredentialCheckReport, AccessCheckFailure>> {
    try {
      return ok(await check_passkey_access(source, location.hostname));
    } catch {
      return err(new AccessCheckFailure(AccessCheckFailureKind.Passkey));
    }
  }

  async checkBackupPassword({
    source,
    password,
  }: BackupPasswordCheckRequest): Promise<
    Result<CredentialCheckReport, AccessCheckFailure>
  > {
    try {
      return ok(await check_backup_password_access(source, password));
    } catch {
      return err(new AccessCheckFailure(AccessCheckFailureKind.BackupPassword));
    }
  }
}

/** The short form of a passkey fingerprint people can compare by eye. */
export function shortPasskeyId(fingerprint: string): string {
  return fingerprint.replace(/^passkey_/, "").slice(0, 8);
}

/** The checks run on one page, read vault by vault. */
export class CheckReports {
  constructor(readonly reports: readonly CredentialCheckReport[]) {}

  /** Every vault the reports cover, in first-seen order. */
  vaults(): readonly VaultCheck[] {
    const vaults: VaultCheck[] = [];
    for (const report of this.reports)
      for (const vault of report.vaults)
        if (!vaults.some((seen) => seen.storeId === vault.storeId))
          vaults.push(vault);
    return vaults;
  }

  /** The name some check decrypted for a vault, or empty when none did. */
  vaultName(storeId: string): string {
    for (const report of this.reports)
      for (const vault of report.vaults)
        if (
          vault.storeId === storeId &&
          vault.outcome.state === "opens" &&
          vault.outcome.name.state === "named"
        )
          return vault.outcome.name.name;
    return "";
  }

  /** The short id of the first checked passkey that opened a vault, or
   * empty when none did. */
  openingPasskey(storeId: string): string {
    for (const report of this.reports) {
      switch (report.credential.kind) {
        case "backupPassword":
          continue;
        case "passkey":
          if (
            report.vaults.some(
              (vault) =>
                vault.storeId === storeId && vault.outcome.state === "opens",
            )
          )
            return shortPasskeyId(report.credential.fingerprint);
      }
    }
    return "";
  }
}
