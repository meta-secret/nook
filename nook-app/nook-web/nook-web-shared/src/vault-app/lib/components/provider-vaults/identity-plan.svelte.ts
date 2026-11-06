import { err, ok, type Result } from "neverthrow";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  provider_identity_choices,
  type CredentialCheckReport,
  type FilingIdentity,
  type IdentityDecision,
  type IdentitySession,
  type NookProviderIdentityChoicesRequest,
  type ProviderIdentityChoice,
  type ProviderVaultSummary,
} from "$app-wasm";

/** A listing and the checks run on its page, for one session. */
export type IdentityChoicesRequest = {
  readonly vaults: readonly ProviderVaultSummary[];
  readonly identities: readonly FilingIdentity[];
  readonly checks: readonly CredentialCheckReport[];
  readonly authenticated: boolean;
};

/** Rust could not group the listing. */
export class IdentityChoicesFailure {
  readonly translationKey = I18N_KEYS.ProviderIdentitiesChoicesFailed;
}

/**
 * Every identity a listing holds, with its standing and the decisions Rust
 * allows for it. Svelte only renders them.
 */
export function identityChoices(
  request: IdentityChoicesRequest,
): Result<readonly ProviderIdentityChoice[], IdentityChoicesFailure> {
  const session: IdentitySession = request.authenticated
    ? "identityInUse"
    : "noIdentity";
  const typed: NookProviderIdentityChoicesRequest = {
    vaults: [...request.vaults],
    identities: [...request.identities],
    checks: [...request.checks],
    session,
  };
  try {
    return ok(provider_identity_choices(typed).identities);
  } catch {
    return err(new IdentityChoicesFailure());
  }
}

/** One decision picked for one identity. */
export type IdentityPick = {
  readonly identityId: string;
  readonly decision: IdentityDecision;
};

/** One decision the plan will run, for the identity it names. */
export type PlannedDecision = {
  readonly choice: ProviderIdentityChoice;
  readonly decision: IdentityDecision;
};

/**
 * The decisions picked on one page, at most one per identity. An identity
 * nothing is picked for is left as it is; picking its decision again takes
 * it out of the plan.
 */
export class IdentityPlan {
  private picks = $state<readonly IdentityPick[]>([]);

  /** Whether this decision is picked for the identity. */
  isPicked(pick: IdentityPick): boolean {
    return this.picks.some(
      (picked) =>
        picked.identityId === pick.identityId &&
        picked.decision === pick.decision,
    );
  }

  /** Pick a decision for its identity, in place of any other; picking it
   * again unpicks it. */
  decide(pick: IdentityPick): void {
    const others = this.picks.filter(
      (picked) => picked.identityId !== pick.identityId,
    );
    this.picks = this.isPicked(pick) ? others : [...others, pick];
  }

  clear(): void {
    this.picks = [];
  }

  /** What will run, in listing order; a decision an identity no longer
   * allows is dropped. */
  planned(
    choices: readonly ProviderIdentityChoice[],
  ): readonly PlannedDecision[] {
    const planned: PlannedDecision[] = [];
    for (const choice of choices) {
      for (const picked of this.picks) {
        if (
          picked.identityId === choice.identity.identityId &&
          choice.decisions.includes(picked.decision)
        ) {
          const entry: PlannedDecision = { choice, decision: picked.decision };
          planned.push(entry);
        }
      }
    }
    return planned;
  }
}

/** The words for an identity's name and for each decision about it. */
export class IdentityDecisionText {
  constructor(private readonly vault: VaultState) {}

  /** The identity's name, else its three words. */
  name(choice: ProviderIdentityChoice): string {
    switch (choice.identity.name.state) {
      case "named":
        return choice.identity.name.name;
      case "unknown":
        return choice.identity.words.join("-");
    }
  }

  /** What one decision does, said for the screen it is on. */
  decision(decision: IdentityDecision): string {
    const vault = this.vault;
    switch (decision) {
      case "addToBrowser":
        return vault.identityInUse
          ? vault.t(I18N_KEYS.ProviderIdentitiesAdd)
          : vault.t(I18N_KEYS.ProviderIdentitiesRecover);
      case "recoverWithPassphrase":
        return vault.t(I18N_KEYS.RecoveryPassphraseRecoverAction);
      case "addWithPasskeyInUse":
        return vault.t(I18N_KEYS.ProviderIdentitiesAdd);
      case "askToJoin":
        return vault.t(I18N_KEYS.ProviderIdentitiesAskToJoin);
      case "finishJoining":
        return vault.t(I18N_KEYS.ProviderIdentitiesFinishJoining);
    }
  }
}
