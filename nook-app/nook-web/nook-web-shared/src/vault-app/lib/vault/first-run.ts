import { err, ok, type Result } from "neverthrow";
import type { NookProviderSource, ProviderIdentityChoice } from "$app-wasm";
import {
  GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  OAUTH_FILE_PROVIDER_TYPE,
  type ProviderSetupRequest,
} from "$lib/auth/providers";
import { IdentityDecisionText } from "$lib/components/provider-vaults/identity-plan.svelte";
import type { VaultState } from "$lib/vault.svelte";
import {
  FirstRunJoinKind,
  type IdentityJoinIntent,
} from "$lib/vault/identity-join-wait";
import {
  IdentityJoinActions,
  IdentityJoinAsked,
  IdentityPlanActions,
  IdentityPlanFailure,
  IdentityPlanFailureKind,
  type IdentityPlanRun,
} from "$lib/vault/identity-plan-actions";
import { VaultOAuthActions } from "$lib/vault/oauth";
import { OAuthFileDraftKind } from "$lib/vault/state/provider.svelte";
import { FirstRunPlace, FirstRunStage } from "$lib/vault/state/ui.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** One identity a sync provider holds, and the provider it was read from. */
export type FirstRunIdentity = {
  readonly choice: ProviderIdentityChoice;
  readonly source: NookProviderSource;
};

/** The one action setup offers for an identity. */
export enum FirstRunIdentityAction {
  /** This browser's key is a member: bring the identity here and sync. */
  Continue = "continue",
  /** Not a member: ask its devices to let this browser in. */
  AskToJoin = "ask-to-join",
  /** A join was asked before: read its answer. */
  CheckJoin = "check-join",
}

/** An action picked for one listed identity. */
export type FirstRunIdentityRun = FirstRunIdentity & {
  readonly action: FirstRunIdentityAction;
};

/** The identity could not be named. */
class FirstRunNamingFailure {
  readonly translationKey = I18N_KEYS.FirstRunNameFailed;
}

/**
 * First-run setup, identity first: the passkey makes this browser's key, the
 * sync provider shows the identities that key is a member of or may join,
 * and only a new identity gets a first vault. Rust decides each identity's
 * one setup action; this class runs it.
 */
export class FirstRunActions {
  constructor(private readonly vault: VaultState) {}

  /** The device key is ready. During first run it only makes the identity's
   * key, and setup moves on to the sync provider; elsewhere it creates the
   * vault as before. */
  async createWithDeviceKeys(label: string): Promise<void> {
    const vault = this.vault;
    if (vault.firstRun !== FirstRunStage.Protect) {
      await vault.createLocalVaultWithDeviceKeys(label);
      return;
    }
    const initialized = await vault.initDeviceIdentity();
    if (initialized.isErr()) {
      vault.errorMsg = vault.t(initialized.error.translationKey);
      vault.firstRun = FirstRunStage.Off;
      return;
    }
    vault.firstRun = FirstRunStage.Sync;
  }

  /** Stage Google Drive, ready for its sign-in. */
  beginGoogleDrive(): void {
    const request: ProviderSetupRequest = {
      type: OAUTH_FILE_PROVIDER_TYPE,
      oauthPreset: GOOGLE_DRIVE_OAUTH_FILE_PRESET,
    };
    this.vault.beginProviderSetup(request);
  }

  /** Name a new identity next: on the signed-in sync provider, or on this
   * browser only. */
  nameNew(place: FirstRunPlace): void {
    const vault = this.vault;
    if (place === FirstRunPlace.ThisBrowser) vault.cancelProviderSetup();
    vault.firstRunPlace = place;
    vault.firstRun = FirstRunStage.Name;
  }

  /** Back from naming or a join to the sync provider's identities. */
  backToSync(): void {
    const vault = this.vault;
    vault.firstRunJoin = { kind: FirstRunJoinKind.None };
    vault.firstRun = FirstRunStage.Sync;
  }

  /** Create the named identity and its first vault. On the sync provider
   * path the signed-in provider stays staged, so the vault connects it next
   * without another sign-in. */
  async createNamed(name: string): Promise<void> {
    const vault = this.vault;
    const label = name.trim();
    if (!label) return;
    const named = await this.nameIdentity(label);
    if (named.isErr()) {
      vault.errorMsg = vault.t(named.error.translationKey);
      return;
    }
    const draft = vault.oauthFileDraft;
    vault.firstRunVaultName = label;
    await vault.createLocalVaultWithDeviceKeys(label);
    if (!vault.isAuthenticated) return;
    if (
      vault.firstRunPlace === FirstRunPlace.SyncProvider &&
      draft.kind === OAuthFileDraftKind.Configured
    ) {
      this.beginGoogleDrive();
      vault.configureOauthFile(draft.config);
      vault.firstRun = FirstRunStage.Connect;
      return;
    }
    vault.firstRun = FirstRunStage.Off;
  }

  /** Run the action picked for one listed identity. */
  async runOn(run: FirstRunIdentityRun): Promise<void> {
    switch (run.action) {
      case FirstRunIdentityAction.Continue:
        return this.continueOn(run);
      case FirstRunIdentityAction.AskToJoin:
        return this.askToJoin(run);
      case FirstRunIdentityAction.CheckJoin:
        return this.resumeJoin(run);
    }
  }

  /** Continue on an identity this browser's key is a member of: bring it
   * here, then connect the sync provider and sync its events. */
  async continueOn({ choice, source }: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    if (choice.setup.kind !== "continue") return;
    if (choice.setup.decision !== "leave") {
      const run: IdentityPlanRun = {
        source,
        planned: [{ choice, decision: choice.setup.decision }],
      };
      const ran = await new IdentityPlanActions(vault).run(run);
      if (ran.isErr()) {
        vault.errorMsg = vault.t(ran.error.translationKey);
        return;
      }
    }
    await this.connectProvider();
  }

  /** Ask to join an identity this browser's key is not a member of. The
   * key is fresh, so it asks at once; setup then waits for an answer. */
  async askToJoin(identity: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    const join = this.intent(identity);
    const asked = await new IdentityJoinActions(vault).ask(join);
    if (asked.isErr()) {
      vault.errorMsg = vault.t(asked.error.translationKey);
      return;
    }
    if (asked.value !== IdentityJoinAsked.Requested) {
      const failure = new IdentityPlanFailure(IdentityPlanFailureKind.Join);
      vault.errorMsg = vault.t(failure.translationKey);
      return;
    }
    vault.firstRunJoin = { kind: FirstRunJoinKind.Asked, join };
    vault.firstRun = FirstRunStage.Joining;
  }

  /** A join asked before this page, as after a reload: wait on it again and
   * read its answer at once. */
  async resumeJoin(identity: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    vault.firstRunJoin = {
      kind: FirstRunJoinKind.Asked,
      join: this.intent(identity),
    };
    vault.firstRun = FirstRunStage.Joining;
    await this.checkJoin();
  }

  /** Read the identity's log again. Approved finishes the join and sets the
   * identity up here; pending or denied says so and changes nothing. */
  async checkJoin(): Promise<void> {
    const vault = this.vault;
    const waiting = vault.firstRunJoin;
    if (waiting.kind !== FirstRunJoinKind.Asked) return;
    const finished = await new IdentityJoinActions(vault).finish(waiting.join);
    if (finished.isErr()) {
      vault.errorMsg = vault.t(finished.error.translationKey);
      return;
    }
    vault.firstRunJoin = { kind: FirstRunJoinKind.None };
    await this.connectProvider();
  }

  /** Bind the provider's Nook folder and connect it: the identity's events
   * sync, and setup ends once a vault of it is open with the provider saved.
   * A connection that fails keeps setup where it is, with its error. */
  async connectProvider(): Promise<boolean> {
    const vault = this.vault;
    vault.errorMsg = "";
    const folder = await new VaultOAuthActions(
      vault,
    ).connectGoogleVaultFolder();
    if (folder.isErr()) {
      vault.errorMsg = vault.t(folder.error.translationKey);
      return false;
    }
    await vault.connectStagedProvider();
    const connected = vault.isAuthenticated && !vault.errorMsg;
    if (connected) vault.firstRun = FirstRunStage.Off;
    return connected;
  }

  private intent({ choice, source }: FirstRunIdentity): IdentityJoinIntent {
    return {
      source,
      identityId: choice.identity.identityId,
      label: new IdentityDecisionText(this.vault).name(choice),
    };
  }

  /** Give this browser's still-fresh identity its name, before its log
   * exists to seal it. */
  private async nameIdentity(
    label: string,
  ): Promise<Result<true, FirstRunNamingFailure>> {
    const vault = this.vault;
    const ran = await vault.enqueueStorage<true, FirstRunNamingFailure>(
      async () => {
        const admitted = vault.admitManager();
        if (admitted.isErr()) return err(new FirstRunNamingFailure());
        try {
          await admitted.value.name_fresh_identity(label);
          return ok(true);
        } catch {
          return err(new FirstRunNamingFailure());
        }
      },
    );
    return ran.mapErr(() => new FirstRunNamingFailure());
  }
}
