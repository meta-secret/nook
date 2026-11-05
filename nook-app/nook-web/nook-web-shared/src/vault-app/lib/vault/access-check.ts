import { err, ok, type Result } from "neverthrow";
import {
  check_passkey_access,
  provider_failure_translation_key,
  type CredentialCheckReport,
  type IdentityCheck,
  type NookAccessCheckSource,
  type NookProviderSource,
  type NookVaultManager,
  type VaultCheck,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** A passkey check that could not finish; what it says to the user. */
export class AccessCheckFailure {

  /** The same check's failure, with the message Rust picks for what
   * stopped it: a refused GitHub token or S3 key names what to fix, and any
   * other failure keeps the check's own message. */
  refusedBy<NativeCause>(refusal: NativeCause): AccessCheckFailure {
    const message =
      refusal instanceof Error ? refusal.message : String(refusal);
    const keyRequest: Parameters<typeof provider_failure_translation_key>[0] = {
      message,
      operationFailedKey: this.translationKey,
    };
    return new AccessCheckRefusal(provider_failure_translation_key(keyRequest));
  }

  get translationKey(): string {
    return I18N_KEYS.AccessCheckPasskeyFailed;
  }
}

/** A check a provider refused, with Rust's message for the refusal. */
class AccessCheckRefusal extends AccessCheckFailure {
  private readonly refusalKey: string;

  constructor(translationKey: string) {
    super();
    this.refusalKey = translationKey;
  }

  override get translationKey(): string {
    return this.refusalKey;
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

type CheckResult = Result<CredentialCheckReport, AccessCheckFailure>;

/** The provider this session is connected to or has staged for a recovery. */
function currentProvider(): NookProviderSource {
  return { kind: "currentProvider" };
}

/**
 * Read-only checks of which vaults a passkey opens. Rust
 * decrypts in memory and reports each vault by name; nothing is stored,
 * imported, or written to the source.
 */
export class AccessCheckActions {
  constructor(private readonly vault: VaultState) {}

  async checkPasskey(target: AccessCheckTarget): Promise<CheckResult> {
    const failure = new AccessCheckFailure();
    switch (target.kind) {
      case AccessCheckTargetKind.Source:
        try {
          return ok(
            await check_passkey_access(target.source, location.hostname),
          );
        } catch (refusal) {
          return err(failure.refusedBy(refusal));
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
      } catch (refusal) {
        return err(failure.refusedBy(refusal));
      }
    });
    // A queue that refused the check (local data being deleted) is the
    // same failed check to the user; the check's own failure keeps its message.
    return checked.mapErr((refused) => {
      if (refused instanceof AccessCheckFailure) return refused;
      return failure;
    });
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
  const draft = vault.providerDraft;
  if (
    vault.loginSetup.kind === LoginSetupKind.Active &&
    draft.type === "local-folder" &&
    draft.state === "selected"
  )
    return {
      kind: "remote",
      source: { kind: "localFolder", handleId: draft.handleId },
    };
  return currentProvider();
}

/** Where a recovery's checks read from: the same provider as its plan. */
export function recoveryCheckTarget(vault: VaultState): AccessCheckTarget {
  const source = recoveryProviderSource(vault);
  switch (source.kind) {
    case "currentProvider":
      return { kind: AccessCheckTargetKind.CurrentProvider };
    case "remote":
      return {
        kind: AccessCheckTargetKind.Source,
        source: { kind: "remote", source: source.source },
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
    for (const report of this.reports)
      if (
        report.identities.some(
          (identity) =>
            identity.identityId === identityId && identityOpens(identity),
        )
      )
        return shortPasskeyId(report.credential.fingerprint);
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
