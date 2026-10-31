import { err, ok, type Result } from "neverthrow";
import type {
  NookIdentityJoinAsk,
  NookIdentityJoinCompletion,
  NookProviderSource,
  NookVaultManager,
} from "$app-wasm";
import {
  IdentityDecisionText,
  type PlannedDecision,
} from "$lib/components/provider-vaults/identity-plan.svelte";
import { IdentityDirectoryLoader } from "$lib/components/identities/identity-directory-loader.svelte";
import type { VaultState } from "$lib/vault.svelte";
import {
  IdentityJoinWaitKind,
  type IdentityJoinIntent,
  type WaitingIdentityJoin,
} from "$lib/vault/identity-join-wait";
import { NewIdentityStage } from "$lib/vault/state/ui.svelte";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

export enum IdentityPlanOutcomeKind {
  /** Every decision ran. */
  Applied = "applied",
  /** A join waits for the fresh key it asks with; the page hands over to
   * that key's ceremony, which asks once the key exists. Decisions after
   * the join have not run. */
  WaitsForKey = "waits-for-key",
}

export type IdentityPlanOutcome =
  | { readonly kind: IdentityPlanOutcomeKind.Applied }
  | {
      readonly kind: IdentityPlanOutcomeKind.WaitsForKey;
      readonly wait: WaitingIdentityJoin;
    };

export enum IdentityPlanFailureKind {
  Add = "add",
  Join = "join",
  /** No device of the identity approved the request yet. */
  JoinPending = "join-pending",
  /** A device of the identity denied the request. */
  JoinDenied = "join-denied",
  FinishJoin = "finish-join",
}

/** A decision that could not run; the plan stops there. */
export class IdentityPlanFailure {
  private refusal = "";

  constructor(readonly kind: IdentityPlanFailureKind) {}

  /** The same failure with what refused it, as Rust said it. */
  because(refusal: string): IdentityPlanFailure {
    const failure = new IdentityPlanFailure(this.kind);
    failure.refusal = refusal;
    return failure;
  }

  /** What failed and, when Rust refused it, why, so the user knows what
   * went wrong instead of only that something did. */
  message(vault: VaultState): string {
    const failed = vault.t(this.translationKey);
    if (!this.refusal) return failed;
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderIdentitiesFailedBecause,
      replacements: {
        failure: failed,
        reason: vault.resolveErrorMessage(this.refusal),
      },
    };
    return vault.t(request);
  }

  get translationKey(): I18nKey {
    switch (this.kind) {
      case IdentityPlanFailureKind.Add:
        return I18N_KEYS.ProviderIdentitiesAddFailed;
      case IdentityPlanFailureKind.Join:
        return I18N_KEYS.ProviderIdentitiesJoinFailed;
      case IdentityPlanFailureKind.JoinPending:
        return I18N_KEYS.ProviderIdentitiesJoinPending;
      case IdentityPlanFailureKind.JoinDenied:
        return I18N_KEYS.ProviderIdentitiesJoinDenied;
      case IdentityPlanFailureKind.FinishJoin:
        return I18N_KEYS.ProviderIdentitiesFinishJoinFailed;
    }
  }
}

/** The decisions to run, and the provider their identities live on. */
export type IdentityPlanRun = {
  readonly source: NookProviderSource;
  readonly planned: readonly PlannedDecision[];
};

/** One call through the session's manager, and what its failure means. */
type ManagerCall<T> = {
  readonly failure: IdentityPlanFailure;
  readonly run: (manager: NookVaultManager) => Promise<T>;
};

/** Runs identity calls through the session's manager. */
class IdentityManagerCalls {
  constructor(private readonly vault: VaultState) {}

  /** Run one call after any queued storage work, so it reads a settled
   * provider. Any refusal is the call's failure, carrying what Rust said. */
  async run<T>(call: ManagerCall<T>): Promise<Result<T, IdentityPlanFailure>> {
    const vault = this.vault;
    const ran = await vault.enqueueStorage<T, IdentityPlanFailure>(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(call.failure);
      try {
        return ok(await call.run(admitted.value));
      } catch (refusal) {
        return err(
          call.failure.because(
            refusal instanceof Error ? refusal.message : String(refusal),
          ),
        );
      }
    });
    // A queue that refused the call (local data being deleted) is the call's
    // failure; a refusal from Rust keeps its reason.
    return ran.mapErr((failure) =>
      failure instanceof IdentityPlanFailure ? failure : call.failure,
    );
  }
}

export enum IdentityJoinAsked {
  /** The request is in the identity's log at the provider. */
  Requested = "requested",
  /** No key is unlocked here yet. */
  WaitsForDevice = "waits-for-device",
  /** The key in use belongs to an identity; Rust staged a new one. */
  WaitsForNewKey = "waits-for-new-key",
  /** A member key held here added the asking key: the identity is here. */
  Joined = "joined",
}

/**
 * Asking to join an identity and finishing the join. Every request comes
 * from a fresh, protected key: Rust decides whether the unlocked key is one,
 * or stages a new local identity whose own key ceremony makes one. A join
 * waits on the vault state for that key, so one action is live at a time.
 */
export class IdentityJoinActions {
  constructor(private readonly vault: VaultState) {}

  /** Ask with the unlocked key when it is fresh; otherwise say which key
   * the join waits for. */
  async ask(
    join: IdentityJoinIntent,
  ): Promise<Result<IdentityJoinAsked, IdentityPlanFailure>> {
    if (!this.vault.deviceProtectionReady)
      return ok(IdentityJoinAsked.WaitsForDevice);
    const call: ManagerCall<IdentityJoinAsked> = {
      failure: new IdentityPlanFailure(IdentityPlanFailureKind.Join),
      run: async (manager) => {
        const start = await manager.begin_identity_join(
          join.identityId,
          join.label,
        );
        switch (start) {
          case "current-key":
            return IdentityJoinActions.asked(
              await manager.request_identity_join(join.source, join.identityId),
            );
          case "new-key-staged":
            return IdentityJoinAsked.WaitsForNewKey;
        }
      },
    };
    return new IdentityManagerCalls(this.vault).run(call);
  }

  /** What Rust's answer to a join request means for the join. */
  private static asked(ask: NookIdentityJoinAsk): IdentityJoinAsked {
    switch (ask.state) {
      case "requested":
        return IdentityJoinAsked.Requested;
      case "joined":
        return IdentityJoinAsked.Joined;
    }
  }

  /** Hand the join to the ceremony of the key it waits for. */
  waitFor(wait: WaitingIdentityJoin): void {
    const vault = this.vault;
    vault.identityJoin = wait;
    switch (wait.kind) {
      case IdentityJoinWaitKind.Device:
        return;
      case IdentityJoinWaitKind.NewKey:
        vault.newIdentityName = wait.join.label;
        vault.newIdentity = NewIdentityStage.Key;
    }
  }

  /** The key the join waited for exists now: ask with it. A key that still
   * cannot ask stops the join instead of starting another ceremony. */
  async resume(
    wait: WaitingIdentityJoin,
  ): Promise<Result<IdentityJoinAsked, IdentityPlanFailure>> {
    this.vault.identityJoin = { kind: IdentityJoinWaitKind.Idle };
    const asked = await this.ask(wait.join);
    if (asked.isErr()) return asked;
    switch (asked.value) {
      case IdentityJoinAsked.Requested:
        this.announce();
        return asked;
      case IdentityJoinAsked.Joined:
        await this.follow(wait.join);
        return asked;
      case IdentityJoinAsked.WaitsForNewKey:
        if (wait.kind === IdentityJoinWaitKind.Device) {
          const next: WaitingIdentityJoin = {
            kind: IdentityJoinWaitKind.NewKey,
            join: wait.join,
          };
          this.waitFor(next);
          return asked;
        }
        this.cancelStagedKey();
        return err(new IdentityPlanFailure(IdentityPlanFailureKind.Join));
      case IdentityJoinAsked.WaitsForDevice:
        return err(new IdentityPlanFailure(IdentityPlanFailureKind.Join));
    }
  }

  /** Leave a waiting join; a new identity staged for it goes too. */
  cancel(): void {
    const wait = this.vault.identityJoin;
    this.vault.identityJoin = { kind: IdentityJoinWaitKind.Idle };
    switch (wait.kind) {
      case IdentityJoinWaitKind.Idle:
      case IdentityJoinWaitKind.Device:
        return;
      case IdentityJoinWaitKind.NewKey:
        this.cancelStagedKey();
    }
  }

  private cancelStagedKey(): void {
    const manager = this.vault.admitManager();
    if (manager.isOk()) manager.value.cancel_local_identity_creation();
  }

  announce(): void {
    this.vault.showSuccess(this.vault.t(I18N_KEYS.AccessCheckJoinRequested));
  }

  /** Finish a join a device approved: Rust adds the identity under its
   * original id, then the page follows it as after an invite join. */
  async finish(
    join: IdentityJoinIntent,
  ): Promise<Result<IdentityPlanOutcomeKind, IdentityPlanFailure>> {
    const call: ManagerCall<NookIdentityJoinCompletion["state"]> = {
      failure: new IdentityPlanFailure(IdentityPlanFailureKind.FinishJoin),
      run: async (manager) =>
        (await manager.complete_identity_join(join.source, join.identityId))
          .state,
    };
    const completed = await new IdentityManagerCalls(this.vault).run(call);
    if (completed.isErr()) return err(completed.error);
    switch (completed.value) {
      case "pending":
        return err(
          new IdentityPlanFailure(IdentityPlanFailureKind.JoinPending),
        );
      case "denied":
        return err(new IdentityPlanFailure(IdentityPlanFailureKind.JoinDenied));
      case "approved":
        break;
    }
    await this.follow(join);
    return ok(IdentityPlanOutcomeKind.Applied);
  }

  /** The identity is on this browser now: the page follows it as after an
   * invite join. */
  async follow(join: IdentityJoinIntent): Promise<void> {
    const vault = this.vault;
    await new IdentityDirectoryLoader(vault).reload();
    const followed = await vault.identityControl.followInviteJoin(join.label);
    if (followed.isErr())
      vault.errorMsg = vault.t(followed.error.translationKey);
  }
}

/**
 * Runs an identity plan, one decision at a time, in listing order. Rust
 * proves each one (a passkey tap for adding or merging, a fresh key for
 * joining) and fails closed; the first failure stops the plan.
 */
export class IdentityPlanActions {
  constructor(private readonly vault: VaultState) {}

  async run({
    source,
    planned,
  }: IdentityPlanRun): Promise<
    Result<IdentityPlanOutcome, IdentityPlanFailure>
  > {
    const names = new IdentityDecisionText(this.vault);
    for (const { choice, decision } of planned) {
      const join: IdentityJoinIntent = {
        source,
        identityId: choice.identity.identityId,
        label: names.name(choice),
      };
      const step: PlanStep = { decision, join };
      const ran = await this.step(step);
      if (ran.isErr()) return err(ran.error);
      switch (ran.value.kind) {
        case IdentityPlanOutcomeKind.Applied:
          continue;
        case IdentityPlanOutcomeKind.WaitsForKey:
          return ran;
      }
    }
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    };
    return ok(applied);
  }

  /** Run one decision for one identity. */
  private async step({
    decision,
    join,
  }: PlanStep): Promise<Result<IdentityPlanOutcome, IdentityPlanFailure>> {
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    };
    const calls = new IdentityManagerCalls(this.vault);
    const joins = new IdentityJoinActions(this.vault);
    switch (decision) {
      case "leave":
        return ok(applied);
      case "addToBrowser": {
        const add: ManagerCall<IdentityPlanOutcome> = {
          failure: new IdentityPlanFailure(IdentityPlanFailureKind.Add),
          run: async (manager) => {
            await manager.add_identity_with_passkey(
              join.source,
              join.identityId,
              location.hostname,
            );
            return applied;
          },
        };
        return calls.run(add);
      }
      case "askToJoin": {
        const asked = await joins.ask(join);
        if (asked.isErr()) return err(asked.error);
        const waiting: AskedJoin = { asked: asked.value, join };
        const outcome = this.waiting(waiting);
        switch (outcome.kind) {
          case IdentityPlanOutcomeKind.Applied:
            if (asked.value === IdentityJoinAsked.Joined)
              await joins.follow(join);
            else joins.announce();
            break;
          case IdentityPlanOutcomeKind.WaitsForKey:
            joins.waitFor(outcome.wait);
        }
        return ok(outcome);
      }
      case "finishJoining":
        return (await joins.finish(join)).map(() => applied);
    }
  }

  /** Whether an asked join waits for a key, and which. */
  private waiting({ asked, join }: AskedJoin): IdentityPlanOutcome {
    switch (asked) {
      case IdentityJoinAsked.Requested:
      case IdentityJoinAsked.Joined:
        return { kind: IdentityPlanOutcomeKind.Applied };
      case IdentityJoinAsked.WaitsForDevice:
        return {
          kind: IdentityPlanOutcomeKind.WaitsForKey,
          wait: { kind: IdentityJoinWaitKind.Device, join },
        };
      case IdentityJoinAsked.WaitsForNewKey:
        return {
          kind: IdentityPlanOutcomeKind.WaitsForKey,
          wait: { kind: IdentityJoinWaitKind.NewKey, join },
        };
    }
  }
}

/** One decision of a plan, for the identity it names. */
type PlanStep = {
  readonly decision: PlannedDecision["decision"];
  readonly join: IdentityJoinIntent;
};

/** How Rust answered asking to join, for the identity asked. */
type AskedJoin = {
  readonly asked: IdentityJoinAsked;
  readonly join: IdentityJoinIntent;
};
