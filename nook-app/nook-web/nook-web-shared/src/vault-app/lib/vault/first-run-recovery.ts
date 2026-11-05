import { err, ok, type Result } from "neverthrow";
import type {
  IdentityRecoveryPassphraseView,
  NookRecoveryWordsCheck,
} from "$app-wasm";
import { IdentityDirectoryLoader } from "$lib/components/identities/identity-directory-loader.svelte";
import type { VaultState } from "$lib/vault.svelte";
import { FirstRunActions } from "$lib/vault/first-run";
import {
  FirstRunJoinKind,
  type IdentityJoinIntent,
} from "$lib/vault/identity-join-wait";
import {
  IdentityManagerCalls,
  IdentityPlanFailure,
  IdentityPlanFailureKind,
  type ManagerCall,
} from "$lib/vault/identity-plan-actions";
import {
  RecoveryWordsOutcomeKind,
  recoveryWordsOutcome,
  type RecoveryWordsOutcome,
} from "$lib/vault/recovery-words";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Named values required by `FirstRunRecovery.recover`. */
export type FirstRunRecoveryAttempt = {
  readonly join: IdentityJoinIntent;
  /** The recovery passphrase picked by its label. */
  readonly recoveryId: string;
  readonly words: string;
};

enum RecoveryKeyKind {
  /** This browser's fresh key asks: Rust checked the words with it. */
  Checked = "checked",
  /** The key in use belongs to a keyring: setup recovers only with a
   * fresh one. */
  InUse = "in-use",
}

type RecoveryKey =
  | {
      readonly kind: RecoveryKeyKind.Checked;
      readonly check: NookRecoveryWordsCheck;
    }
  | { readonly kind: RecoveryKeyKind.InUse };

/**
 * First-run setup joining a keyring with one of its recovery passphrases.
 * The passkey or PIN step already made this browser's fresh key, so Rust
 * chooses that key, unseals the recovery key with the typed words, and
 * approves it; the join then finishes as an approved request does. Words
 * Rust refuses come back for the form; nothing is written for them.
 */
export class FirstRunRecovery {
  constructor(private readonly vault: VaultState) {}

  /** The keyring's recovery passphrases, by label, from its log at the
   * provider. */
  async passphrases(
    join: IdentityJoinIntent,
  ): Promise<
    Result<readonly IdentityRecoveryPassphraseView[], IdentityPlanFailure>
  > {
    const call: ManagerCall<readonly IdentityRecoveryPassphraseView[]> = {
      failure: new IdentityPlanFailure(IdentityPlanFailureKind.RecoveryRead),
      run: async (manager) =>
        (
          await manager.recovery_passphrases_at_source(
            join.source,
            join.identityId,
          )
        ).passphrases,
    };
    return new IdentityManagerCalls(this.vault).run(call);
  }

  /** Join with the typed words. Accepted, the keyring is set up here and
   * its provider connected, as after an approved join. */
  async recover({
    join,
    recoveryId,
    words,
  }: FirstRunRecoveryAttempt): Promise<
    Result<RecoveryWordsOutcome, IdentityPlanFailure>
  > {
    const vault = this.vault;
    const failure = new IdentityPlanFailure(IdentityPlanFailureKind.Recover);
    if (!vault.deviceProtectionReady)
      return err(failure.because(I18N_KEYS.ErrorsIdentityJoinPasskeyLocked));
    const call: ManagerCall<RecoveryKey> = {
      failure,
      run: async (manager) => {
        const start = await manager.begin_identity_join(
          join.identityId,
          join.label,
        );
        switch (start) {
          case "current-key":
            return {
              kind: RecoveryKeyKind.Checked,
              check: await manager.recover_identity_with_passphrase(
                join.source,
                join.identityId,
                recoveryId,
                words,
              ),
            };
          case "new-key-staged":
            manager.cancel_local_identity_creation();
            return { kind: RecoveryKeyKind.InUse };
        }
      },
    };
    const ran = await new IdentityManagerCalls(vault).run(call);
    if (ran.isErr()) return err(ran.error);
    switch (ran.value.kind) {
      case RecoveryKeyKind.InUse:
        return err(failure.because(I18N_KEYS.ErrorsIdentityJoinPasskeyInUse));
      case RecoveryKeyKind.Checked:
        return this.followed(join, recoveryWordsOutcome(ran.value.check));
    }
  }

  /** After accepted words: load the keyring as after an approved join,
   * then connect its provider and end setup there. This browser is in the
   * keyring either way; a load that failed stays said, and setup does not
   * announce a recovery it did not finish. */
  private async followed(
    ...[join, outcome]: readonly [IdentityJoinIntent, RecoveryWordsOutcome]
  ): Promise<Result<RecoveryWordsOutcome, IdentityPlanFailure>> {
    switch (outcome.kind) {
      case RecoveryWordsOutcomeKind.Refused:
        return ok(outcome);
      case RecoveryWordsOutcomeKind.Accepted:
        break;
    }
    const vault = this.vault;
    await new IdentityDirectoryLoader(vault).reload();
    const loaded = await vault.identityControl.followInviteJoin(join.label);
    vault.firstRunJoin = { kind: FirstRunJoinKind.None };
    const connected = await new FirstRunActions(vault).connectProvider();
    if (loaded.isErr()) {
      vault.errorMsg = vault.t(loaded.error.translationKey);
      return ok(outcome);
    }
    if (connected) {
      const request: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.RecoveryPassphraseRecovered,
        replacements: { identity: join.label },
      };
      vault.showSuccess(vault.t(request));
    }
    return ok(outcome);
  }
}
