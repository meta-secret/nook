import { err, ok, type Result } from "neverthrow";
import type {
  NookIdentityAdded,
  NookIdentityJoinRequested,
  NookIdentityMerged,
  NookProviderSource,
  NookVaultManager,
} from "$app-wasm";
import type { PlannedDecision } from "$lib/components/provider-vaults/identity-plan.svelte";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

/** A plan ran every decision. */
export enum IdentityPlanOutcome {
  Applied = "applied",
}

export enum IdentityPlanFailureKind {
  Add = "add",
  Merge = "merge",
  Join = "join",
}

/** A decision that could not run; the plan stops there. */
export class IdentityPlanFailure {
  constructor(readonly kind: IdentityPlanFailureKind) {}

  get translationKey(): I18nKey {
    switch (this.kind) {
      case IdentityPlanFailureKind.Add:
        return I18N_KEYS.ProviderIdentitiesAddFailed;
      case IdentityPlanFailureKind.Merge:
        return I18N_KEYS.ProviderIdentitiesMergeFailed;
      case IdentityPlanFailureKind.Join:
        return I18N_KEYS.ProviderIdentitiesJoinFailed;
    }
  }
}

/** The decisions to run, and the provider their identities live on. */
export type IdentityPlanRun = {
  readonly source: NookProviderSource;
  readonly planned: readonly PlannedDecision[];
};

/** One decision run through the session's manager. */
type ManagerStep = {
  readonly failure: IdentityPlanFailure;
  readonly run: (
    manager: NookVaultManager,
  ) => Promise<
    NookIdentityAdded | NookIdentityMerged | NookIdentityJoinRequested
  >;
};

/**
 * Runs an identity plan, one decision at a time, in listing order. Rust
 * proves each one (a passkey tap for adding or merging) and fails closed;
 * the first failure stops the plan.
 */
export class IdentityPlanActions {
  constructor(private readonly vault: VaultState) {}

  async run({
    source,
    planned,
  }: IdentityPlanRun): Promise<
    Result<IdentityPlanOutcome, IdentityPlanFailure>
  > {
    for (const { choice, decision } of planned) {
      const identityId = choice.identity.identityId;
      let step: ManagerStep;
      switch (decision) {
        case "leave":
          continue;
        case "addToBrowser":
          step = {
            failure: new IdentityPlanFailure(IdentityPlanFailureKind.Add),
            run: (manager) =>
              manager.add_identity_with_passkey(
                source,
                identityId,
                location.hostname,
              ),
          };
          break;
        case "mergeIntoCurrent":
          step = {
            failure: new IdentityPlanFailure(IdentityPlanFailureKind.Merge),
            run: (manager) =>
              manager.merge_identity_with_passkey(
                source,
                identityId,
                location.hostname,
              ),
          };
          break;
        case "askToJoin":
          step = {
            failure: new IdentityPlanFailure(IdentityPlanFailureKind.Join),
            run: (manager) => manager.request_identity_join(source, identityId),
          };
          break;
      }
      const ran = await this.throughManager(step);
      if (ran.isErr()) return err(ran.error);
    }
    return ok(IdentityPlanOutcome.Applied);
  }

  /** Run one step after any queued storage work, so it reads a settled
   * provider. */
  private async throughManager(
    step: ManagerStep,
  ): Promise<Result<IdentityPlanOutcome, IdentityPlanFailure>> {
    const vault = this.vault;
    const ran = await vault.enqueueStorage<
      IdentityPlanOutcome,
      IdentityPlanFailure
    >(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(step.failure);
      try {
        await step.run(admitted.value);
        return ok(IdentityPlanOutcome.Applied);
      } catch {
        return err(step.failure);
      }
    });
    return ran.mapErr(() => step.failure);
  }
}
