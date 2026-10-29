import { err, ok, type Result } from "neverthrow";
import {
  check_backup_password_access,
  check_passkey_access,
  type CredentialCheckReport,
  type IdentityCheck,
  type NookAccessCheckSource,
  type NookProviderSource,
  type NookVaultManager,
  type VaultCheck,
} from "$app-wasm";
import {
  LOCAL_FOLDER_PROVIDER_TYPE,
  LocalFolderHandleKind,
  LocalFolderPresentation,
} from "$lib/auth/providers";
import type { VaultState } from "$lib/vault.svelte";
import {
  LocalFolderDraftKind,
  LoginSetupKind,
} from "$lib/vault/state/provider.svelte";
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

export enum AccessCheckTargetKind {
  /** A source read on its own: this browser, a Drive account, or a folder. */
  Source = "source",
  /** The sync provider this session is connected to or has staged for a
   * recovery, read with the credentials it already holds. */
  CurrentProvider = "current-provider",
}

/** Where a check reads identity logs and vaults from. */
export type AccessCheckTarget =
  | {
      readonly kind: AccessCheckTargetKind.Source;
      readonly source: NookAccessCheckSource;
    }
  | { readonly kind: AccessCheckTargetKind.CurrentProvider };

/** A typed backup password and where to check it. */
export type BackupPasswordCheckRequest = {
  readonly target: AccessCheckTarget;
  readonly password: string;
};

type CheckResult = Result<CredentialCheckReport, AccessCheckFailure>;

/** The provider this session is connected to or has staged for a recovery. */
function currentProvider(): NookProviderSource {
  return { kind: "currentProvider" };
}

/**
 * Read-only checks of which vaults a passkey or backup password opens. Rust
 * decrypts in memory and reports each vault by name; nothing is stored,
 * imported, or written to the source.
 */
export class AccessCheckActions {
  constructor(private readonly vault: VaultState) {}

  async checkPasskey(target: AccessCheckTarget): Promise<CheckResult> {
    const failure = new AccessCheckFailure(AccessCheckFailureKind.Passkey);
    switch (target.kind) {
      case AccessCheckTargetKind.Source:
        try {
          return ok(
            await check_passkey_access(target.source, location.hostname),
          );
        } catch {
          return err(failure);
        }
      case AccessCheckTargetKind.CurrentProvider: {
        const check: CurrentProviderCheck = {
          failure,
          run: (manager) =>
            manager.check_passkey_access_from(
              currentProvider(),
              location.hostname,
            ),
        };
        return this.atCurrentProvider(check);
      }
    }
  }

  async checkBackupPassword({
    target,
    password,
  }: BackupPasswordCheckRequest): Promise<CheckResult> {
    const failure = new AccessCheckFailure(
      AccessCheckFailureKind.BackupPassword,
    );
    switch (target.kind) {
      case AccessCheckTargetKind.Source:
        try {
          return ok(
            await check_backup_password_access(target.source, password),
          );
        } catch {
          return err(failure);
        }
      case AccessCheckTargetKind.CurrentProvider: {
        const check: CurrentProviderCheck = {
          failure,
          run: (manager) =>
            manager.check_backup_password_access_from(
              currentProvider(),
              password,
            ),
        };
        return this.atCurrentProvider(check);
      }
    }
  }

  /** Run one check through the session's manager, after any queued storage
   * work, so it reads a settled provider. */
  private async atCurrentProvider({
    failure,
    run,
  }: CurrentProviderCheck): Promise<CheckResult> {
    const vault = this.vault;
    const checked = await vault.enqueueStorage<
      CredentialCheckReport,
      AccessCheckFailure
    >(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(failure);
      try {
        return ok(await run(admitted.value));
      } catch {
        return err(failure);
      }
    });
    // A queue that refused the check (local data being deleted) is the
    // same failed check to the user.
    return checked.mapErr(() => failure);
  }
}

/** One check run through the session's manager. */
type CurrentProviderCheck = {
  readonly failure: AccessCheckFailure;
  readonly run: (manager: NookVaultManager) => Promise<CredentialCheckReport>;
};

/** The provider a recovery reads: the folder the user picked, or the
 * provider staged for the recovery. */
export function recoveryProviderSource(vault: VaultState): NookProviderSource {
  if (
    vault.loginSetup.kind === LoginSetupKind.Active &&
    vault.loginSetup.providerType === LOCAL_FOLDER_PROVIDER_TYPE &&
    vault.localFolderDraft.kind === LocalFolderDraftKind.Configured
  ) {
    const handle = new LocalFolderPresentation(
      vault.localFolderDraft.config,
    ).localFolderHandle();
    if (handle.kind === LocalFolderHandleKind.Selected)
      return { kind: "localFolder", handleId: handle.handleId };
  }
  return currentProvider();
}

/** Where a recovery's checks read from: the same provider as its plan. */
export function recoveryCheckTarget(vault: VaultState): AccessCheckTarget {
  const source = recoveryProviderSource(vault);
  switch (source.kind) {
    case "currentProvider":
      return { kind: AccessCheckTargetKind.CurrentProvider };
    case "localFolder":
      return {
        kind: AccessCheckTargetKind.Source,
        source: { kind: "localFolder", handleId: source.handleId },
      };
    case "googleDrive":
      return {
        kind: AccessCheckTargetKind.Source,
        source: { kind: "googleDrive", accessToken: source.accessToken },
      };
  }
}

/** The short form of a passkey fingerprint people can compare by eye. */
export function shortPasskeyId(fingerprint: string): string {
  return fingerprint.replace(/^passkey_/, "").slice(0, 8);
}

/** Whether a passkey opened the identity itself, not only some vaults. */
export function identityOpens(identity: IdentityCheck): boolean {
  switch (identity.outcome) {
    case "opens":
      return true;
    case "vaultsOnly":
    case "doesNotOpen":
      return false;
  }
}

/** One vault a check covered, with the identity that files it. */
export type CheckedVaultRow = {
  readonly vault: VaultCheck;
  readonly identity: IdentityCheck;
};

/** The checks run on one page, read identity by identity. A passkey
 * belongs to an identity, so it opens every vault that identity keeps. */
export class CheckReports {
  constructor(readonly reports: readonly CredentialCheckReport[]) {}

  /** The short id of the first checked passkey that opened an identity, or
   * empty when none did. */
  identityOpenedBy(identityId: string): string {
    for (const report of this.reports) {
      switch (report.credential.kind) {
        case "backupPassword":
          continue;
        case "passkey":
          if (
            report.identities.some(
              (identity) =>
                identity.identityId === identityId && identityOpens(identity),
            )
          )
            return shortPasskeyId(report.credential.fingerprint);
      }
    }
    return "";
  }

  /** The identity's name some passkey opened, or empty when none did. */
  identityName(identityId: string): string {
    for (const report of this.reports)
      for (const identity of report.identities)
        if (
          identity.identityId === identityId &&
          identity.name.state === "named"
        )
          return identity.name.name;
    return "";
  }

  /** Whether a passkey check ran on this page. */
  passkeyChecked(): boolean {
    return this.reports.some((report) => {
      switch (report.credential.kind) {
        case "passkey":
          return true;
        case "backupPassword":
          return false;
      }
    });
  }

  /** The name some check decrypted for a vault, or empty when none did. */
  vaultName(storeId: string): string {
    for (const row of this.vaultRows())
      if (
        row.vault.storeId === storeId &&
        row.vault.outcome.state === "opens" &&
        row.vault.outcome.name.state === "named"
      )
        return row.vault.outcome.name.name;
    return "";
  }

  /** Whether a checked backup password opened a vault. */
  opensWithBackupPassword(storeId: string): boolean {
    return this.reports.some((report) => {
      switch (report.credential.kind) {
        case "passkey":
          return false;
        case "backupPassword":
          return report.identities.some((identity) =>
            identity.vaults.some(
              (vault) =>
                vault.storeId === storeId && vault.outcome.state === "opens",
            ),
          );
      }
    });
  }

  private vaultRows(): readonly CheckedVaultRow[] {
    const rows: CheckedVaultRow[] = [];
    for (const report of this.reports)
      for (const identity of report.identities)
        for (const vault of identity.vaults) {
          const row: CheckedVaultRow = { vault, identity };
          rows.push(row);
        }
    return rows;
  }
}
